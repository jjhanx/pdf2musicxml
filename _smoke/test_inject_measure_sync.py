#!/usr/bin/env python3
"""마디 내 음표 수 차이 시 P2 가사가 m10부터 밀리지 않는지 검증."""
import io
import sys
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from inject_ocr import (  # noqa: E402
    apply_lyric_events,
    apply_lyric_events_measure_sync,
    build_events_for_items,
    find_parts,
    mxl_ns_uri,
    parse_lyric_text_events,
    qname,
)


def _minimal_score():
    ns = "http://www.musicxml.org/ns/score-partwise"
    root = ET.Element(qname(ns, "score-partwise"), version="3.1")
    part_list = ET.SubElement(root, qname(ns, "part-list"))
    for pid in ("P1", "P2"):
        score_part = ET.SubElement(part_list, qname(ns, "score-part"), id=pid)
        ET.SubElement(score_part, qname(ns, "part-name")).text = pid
    for pid in ("P1", "P2"):
        part = ET.SubElement(root, qname(ns, "part"), id=pid)
        for mnum, durs in (
            ("9", [2, 2, 4, 2, 2, 4] if pid == "P1" else [2, 2, 4, 2, 8]),
            ("10", [4, 4]),
        ):
            meas = ET.SubElement(part, qname(ns, "measure"), number=mnum)
            for dur in durs:
                note = ET.SubElement(meas, qname(ns, "note"))
                ET.SubElement(note, qname(ns, "pitch"))
                ET.SubElement(note, qname(ns, "duration")).text = str(dur)
                ET.SubElement(note, qname(ns, "voice")).text = "1"
                ET.SubElement(note, qname(ns, "type")).text = "quarter"
    return root, ns


def _lyrics_on_measure(part, ns, mnum):
    out = []
    for meas in part.findall(qname(ns, "measure")):
        if meas.get("number") != mnum:
            continue
        for note in meas.findall(qname(ns, "note")):
            if note.find(qname(ns, "rest")) is not None:
                continue
            text = ""
            for ly in note.findall(qname(ns, "lyric")):
                te = ly.find(qname(ns, "text"))
                if te is not None and te.text:
                    text += te.text
            out.append(text or "")
    return out


def main():
    root, ns = _minimal_score()
    parts = find_parts(root, ns)
    items = [{"type": "lyrics", "text": "주 여 올리에 빛 비 치 - 에", "lyricPartIndex": 1, "lyricVerseIndex": 1}]
    events = build_events_for_items(items, parts[0], ns)
    apply_lyric_events(parts[0], ns, events, lyric_number=1)
    apply_lyric_events_measure_sync(
        parts[1], ns, events, lyric_number=1, ref_part_el=parts[0], ref_events=events
    )

    p1_m10 = _lyrics_on_measure(parts[0], ns, "10")
    p2_m10 = _lyrics_on_measure(parts[1], ns, "10")
    assert p1_m10 == ["-", "에"], f"P1 m10: {p1_m10}"
    assert p2_m10 == ["-", "에"], f"P2 m10: {p2_m10}"
    print("PASS: P2 m10 lyrics match P1 after measure-sync inject")


if __name__ == "__main__":
    main()
