"""SymbolGraph → MusicXML(.mxl)."""
from __future__ import annotations

import io
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from ai_engine.config import AiOmrConfig
from ai_engine.symbol_graph import SymbolGraph, SymbolNode

_MXL_NS = "http://www.musicxml.org/ns/3.1/score-partwise"


def _q(tag: str) -> str:
    return f"{{{_MXL_NS}}}{tag}"


def _duration_units(node: SymbolNode, divisions: int) -> int:
    if node.duration_type:
        table = {
            "whole": divisions * 4,
            "half": divisions * 2,
            "quarter": divisions,
            "eighth": max(1, divisions // 2),
            "16th": max(1, divisions // 4),
            "32nd": max(1, divisions // 8),
        }
        return table.get(node.duration_type, divisions)
    if node.duration is not None:
        return max(1, round(node.duration * divisions))
    return divisions


def _parse_pitch(pitch: str) -> tuple[str, int, int | None]:
    m = re.match(r"^([A-G])([#b]?)(\d+)$", pitch.strip())
    if not m:
        return "C", 4, None
    step, acc, oct_s = m.group(1), m.group(2), m.group(3)
    alter = None
    if acc == "#":
        alter = 1
    elif acc == "b":
        alter = -1
    return step, int(oct_s), alter


def build_musicxml_tree(graph: SymbolGraph, config: AiOmrConfig) -> ET.Element:
    root = ET.Element(_q("score-partwise"), {"version": "3.1"})
    ET.SubElement(root, _q("work"))
    part_list = ET.SubElement(root, _q("part-list"))

    part_ids: list[str] = []
    for i, pl in enumerate(config.part_layout):
        pid = f"P{i + 1}"
        part_ids.append(pid)
        sp = ET.SubElement(part_list, _q("score-part"), {"id": pid})
        pn = ET.SubElement(sp, _q("part-name"))
        pn.text = pl.part_name

    max_measure = max(1, graph.max_measure())

    nodes_by_part_measure: dict[tuple[int, int], list[SymbolNode]] = {}
    for n in graph.sorted_nodes():
        if n.kind not in ("note", "rest", "clef", "timeSignature"):
            continue
        pi, _ = config.staff_to_part(n.staff)
        nodes_by_part_measure.setdefault((pi, n.measure), []).append(n)

    for pi, pid in enumerate(part_ids):
        part_el = ET.SubElement(root, _q("part"), {"id": pid})
        pl = config.part_layout[pi]
        for mnum in range(1, max_measure + 1):
            measure_el = ET.SubElement(part_el, _q("measure"), {"number": str(mnum)})
            if mnum == 1:
                attrs = ET.SubElement(measure_el, _q("attributes"))
                ET.SubElement(attrs, _q("divisions")).text = str(config.divisions)
                for st in range(1, pl.staff_count + 1):
                    if pl.staff_count > 1:
                        staves = attrs.find(_q("staves"))
                        if staves is None:
                            staves = ET.SubElement(attrs, _q("staves"))
                        staves.text = str(pl.staff_count)
                    clef = ET.SubElement(attrs, _q("clef"))
                    if pl.staff_count > 1:
                        clef.set("number", str(st))
                    sign = ET.SubElement(clef, _q("sign"))
                    sign.text = "G" if st == 1 else "F"
                    line = ET.SubElement(clef, _q("line"))
                    line.text = "2" if st == 1 else "4"
                time_el = ET.SubElement(attrs, _q("time"))
                ET.SubElement(time_el, _q("beats")).text = str(config.beats)
                ET.SubElement(time_el, _q("beat-type")).text = str(config.beat_type)
                if config.key_fifths:
                    key_el = ET.SubElement(attrs, _q("key"))
                    ET.SubElement(key_el, _q("fifths")).text = str(config.key_fifths)

            bucket = nodes_by_part_measure.get((pi, mnum), [])
            bucket.sort(key=lambda n: (n.staff, n.x, n.y))
            for node in bucket:
                if node.kind in ("clef", "timeSignature"):
                    continue
                if node.kind not in ("note", "rest"):
                    continue
                _, staff_in_part = config.staff_to_part(node.staff)
                note_el = ET.SubElement(measure_el, _q("note"))
                if node.rest:
                    ET.SubElement(note_el, _q("rest"))
                elif node.pitch:
                    step, octave, alter = _parse_pitch(node.pitch)
                    pitch_el = ET.SubElement(note_el, _q("pitch"))
                    ET.SubElement(pitch_el, _q("step")).text = step
                    if alter is not None:
                        ET.SubElement(pitch_el, _q("alter")).text = str(alter)
                    ET.SubElement(pitch_el, _q("octave")).text = str(octave)
                dur = _duration_units(node, config.divisions)
                ET.SubElement(note_el, _q("duration")).text = str(dur)
                if node.duration_type:
                    typ = ET.SubElement(note_el, _q("type"))
                    typ.text = node.duration_type
                voice = node.voice or 1
                ET.SubElement(note_el, _q("voice")).text = str(voice)
                if pl.staff_count > 1 or config.total_staves() > 1:
                    st_el = ET.SubElement(note_el, _q("staff"))
                    st_el.text = str(staff_in_part)
                if node.lyric:
                    lyric_el = ET.SubElement(note_el, _q("lyric"))
                    ET.SubElement(lyric_el, _q("syllabic")).text = "single"
                    text_el = ET.SubElement(lyric_el, _q("text"))
                    text_el.text = node.lyric

    return root


def write_mxl(graph: SymbolGraph, config: AiOmrConfig, output_path: Path) -> Path:
    root = build_musicxml_tree(graph, config)
    xml_bytes = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    xml_name = f"{config.output_basename}.xml"
    container = """<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="{xml_name}" media-type="application/vnd.recordare.musicxml+xml"/>
  </rootfiles>
</container>
""".format(
        xml_name=xml_name
    )
    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("META-INF/container.xml", container)
        z.writestr(xml_name, xml_bytes)
    return output_path


def write_musicxml_file(graph: SymbolGraph, config: AiOmrConfig, output_path: Path) -> Path:
    root = build_musicxml_tree(graph, config)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    tree = ET.ElementTree(root)
    tree.write(str(output_path), encoding="utf-8", xml_declaration=True)
    return output_path
