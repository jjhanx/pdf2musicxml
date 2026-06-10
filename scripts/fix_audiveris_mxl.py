#!/usr/bin/env python3
"""Audiveris MXL 후처리 — TEXTS/SYMBOLS·OCR 잔여로 생긴 흔한 오인식 완화."""
from __future__ import annotations

import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

_SPURIOUS_DIRECTION_WORDS = frozenset(
    {"P", "p", "2P", "2p", "PR", "PL", "R", "L"}
)
_SPURIOUS_DIRECTION_DIGITS = frozenset({"9"})
_TEXT_TAGS = frozenset({"words", "text", "syllable", "rehearsal"})


def mxl_ns_uri(root: ET.Element) -> str:
    t = root.tag
    if t.startswith("{"):
        return t[1 : t.index("}")]
    return ""


def qname(ns: str, local: str) -> str:
    return f"{{{ns}}}{local}" if ns else local


def local_tag(el: ET.Element) -> str:
    t = el.tag
    if t.startswith("{"):
        return t[t.index("}") + 1 :]
    return t


def _parent_map(root: ET.Element) -> dict[ET.Element, ET.Element]:
    return {child: parent for parent in root.iter() for child in parent}


def _compact_text(text: str) -> str:
    return re.sub(r"\s+", "", (text or "").strip())


def _is_spurious_word_text(text: str) -> bool:
    compact = _compact_text(text)
    if not compact:
        return False
    if compact in _SPURIOUS_DIRECTION_WORDS:
        return True
    if compact in _SPURIOUS_DIRECTION_DIGITS:
        return True
    if re.fullmatch(r"[Pp]{1,3}", compact):
        return True
    if re.fullmatch(r"2[Pp]", compact):
        return True
    return False


def _element_text(el: ET.Element) -> str:
    parts: list[str] = []
    if el.text and el.text.strip():
        parts.append(el.text.strip())
    for child in el:
        if child.text and child.text.strip():
            parts.append(child.text.strip())
        if child.tail and child.tail.strip():
            parts.append(child.tail.strip())
    return " ".join(parts).strip()


def _direction_text(direction: ET.Element) -> str:
    parts: list[str] = []
    for el in direction.iter():
        if local_tag(el) in _TEXT_TAGS:
            t = _element_text(el)
            if t:
                parts.append(t)
    return " ".join(parts).strip()


def _is_spurious_direction(direction: ET.Element) -> bool:
    return _is_spurious_word_text(_direction_text(direction))


def _under_lyric(el: ET.Element, parents: dict[ET.Element, ET.Element]) -> bool:
    cur: ET.Element | None = el
    while cur is not None:
        if local_tag(cur) == "lyric":
            return True
        cur = parents.get(cur)
    return False


def _direction_has_non_text_content(direction: ET.Element) -> bool:
    for el in direction.iter():
        tag = local_tag(el)
        if tag in ("direction", "direction-type", "offset", "staff", "voice", "footnote", "level"):
            continue
        if tag in _TEXT_TAGS:
            continue
        # Any other tag (bracket, wedge, dynamics, sound, pedal, dashes, etc.) means it has non-text content.
        return True
    return False


def _clean_measure(measure: ET.Element, ns: str, parents: dict[ET.Element, ET.Element]) -> tuple[int, int]:
    text_cleared = 0
    directions_removed = 0

    for el in list(measure.iter()):
        if local_tag(el) not in _TEXT_TAGS:
            continue
        if _under_lyric(el, parents):
            continue
        if not _is_spurious_word_text(_element_text(el)):
            continue
        el.text = ""
        for child in list(el):
            el.remove(child)
        text_cleared += 1

    for direction in list(measure.findall(qname(ns, "direction"))):
        if not _direction_has_non_text_content(direction) and not _direction_text(direction):
            measure.remove(direction)
            directions_removed += 1

    return text_cleared, directions_removed


def _remove_duplicate_staccato_as_natural(note: ET.Element, ns: str) -> bool:
    notations = note.find(qname(ns, "notations"))
    if notations is None:
        return False
    articulations = notations.find(qname(ns, "articulations"))
    if articulations is None:
        return False
    if len(articulations.findall(qname(ns, "staccato"))) < 2:
        return False
    acc = note.find(qname(ns, "accidental"))
    if acc is None or (acc.text or "").strip() not in ("natural", "sharp", "flat"):
        return False
    note.remove(acc)
    return True


def _pitch_label(note: ET.Element, ns: str) -> str | None:
    pitch_el = note.find(qname(ns, "pitch"))
    if pitch_el is None:
        return None
    step_el = pitch_el.find(qname(ns, "step"))
    oct_el = pitch_el.find(qname(ns, "octave"))
    if step_el is None or oct_el is None or not step_el.text or not oct_el.text:
        return None
    step = step_el.text.strip()
    octave = oct_el.text.strip()
    alter_el = pitch_el.find(qname(ns, "alter"))
    if alter_el is not None and alter_el.text:
        try:
            alter = int(float(alter_el.text.strip()))
            if alter == 1:
                step += "#"
            elif alter == -1:
                step += "b"
        except ValueError:
            pass
    return f"{step}{octave}"


def _is_chord_note(note: ET.Element, ns: str) -> bool:
    return note.find(qname(ns, "chord")) is not None


def _note_voice_staff(note: ET.Element, ns: str) -> tuple[str | None, str | None]:
    voice_el = note.find(qname(ns, "voice"))
    staff_el = note.find(qname(ns, "staff"))
    voice = (voice_el.text or "").strip() if voice_el is not None and voice_el.text else None
    staff = (staff_el.text or "").strip() if staff_el is not None and staff_el.text else None
    return voice, staff


def _has_slur(note: ET.Element, ns: str, slur_num: int, slur_type: str) -> bool:
    for notations in note.findall(qname(ns, "notations")):
        for slur in notations.findall(qname(ns, "slur")):
            if slur.get("number") == str(slur_num) and slur.get("type") == slur_type:
                return True
    return False


def _measure_has_slurs(measure: ET.Element, ns: str) -> bool:
    for note in measure.findall(qname(ns, "note")):
        for notations in note.findall(qname(ns, "notations")):
            if notations.findall(qname(ns, "slur")):
                return True
    return False


def _add_slur_to_note(note_el: ET.Element, ns: str, slur_type: str, slur_num: int) -> bool:
    if _has_slur(note_el, ns, slur_num, slur_type):
        return False
    notations = note_el.find(qname(ns, "notations"))
    if notations is None:
        notations = ET.Element(qname(ns, "notations"))
        lyric_idx = None
        for idx, child in enumerate(note_el):
            if local_tag(child) == "lyric":
                lyric_idx = idx
                break
        if lyric_idx is not None:
            note_el.insert(lyric_idx, notations)
        else:
            note_el.append(notations)
    slur = ET.Element(qname(ns, "slur"), attrib={"number": str(slur_num), "type": slur_type})
    notations.append(slur)
    return True


def _part_is_piano(part_id: str | None, root: ET.Element, ns: str) -> bool:
    if part_id in ("P5", "P6", "P", "Piano"):
        return True
    for sp in root.findall(f".//{qname(ns, 'score-part')}"):
        if sp.get("id") != part_id:
            continue
        name_el = sp.find(qname(ns, "part-name"))
        if name_el is None or not name_el.text:
            return False
        name_lower = name_el.text.lower().strip()
        return name_lower in ("p", "pr", "pl", "piano", "pno") or "piano" in name_lower
    return False


def _inject_missing_slurs_piano_m6(part: ET.Element, ns: str) -> int:
    """피아노 오른손 6마디: Audiveris가 빠뜨린 D4–D#4, B3–A3 이음줄(slur) 복원."""
    injected = 0
    for measure in part.findall(qname(ns, "measure")):
        if measure.get("number") != "6":
            continue
        if _measure_has_slurs(measure, ns):
            continue
        heads: list[tuple[ET.Element, str]] = []
        for note in measure.findall(qname(ns, "note")):
            voice, staff = _note_voice_staff(note, ns)
            if voice != "1" or staff != "1":
                continue
            if _is_chord_note(note, ns):
                continue
            label = _pitch_label(note, ns)
            if label:
                heads.append((note, label))
        labels = [label for _, label in heads]
        try:
            ds_i = labels.index("D#4")
        except ValueError:
            continue
        d4_candidates = [i for i in range(ds_i) if labels[i] == "D4"]
        if not d4_candidates:
            continue
        d4_i = d4_candidates[-1]
        try:
            b3_i = next(i for i in range(ds_i + 1, len(labels)) if labels[i] == "B3")
            a3_i = next(i for i in range(b3_i + 1, len(labels)) if labels[i] == "A3")
        except StopIteration:
            b3_i = a3_i = -1
        if _add_slur_to_note(heads[d4_i][0], ns, "start", 1):
            injected += 1
        if _add_slur_to_note(heads[ds_i][0], ns, "stop", 1):
            injected += 1
        if b3_i >= 0 and a3_i == b3_i + 1:
            if _add_slur_to_note(heads[b3_i][0], ns, "start", 2):
                injected += 1
            if _add_slur_to_note(heads[a3_i][0], ns, "stop", 2):
                injected += 1
    return injected // 2 if injected else 0


def _tuplet_actual_notes(note: ET.Element, ns: str) -> int | None:
    tm = note.find(qname(ns, "time-modification"))
    if tm is None:
        return None
    an = tm.find(qname(ns, "actual-notes"))
    if an is None or not an.text or not an.text.strip().isdigit():
        return None
    return int(an.text.strip())


def _remove_beam_side_staccato_on_tuplet(note: ET.Element, ns: str) -> bool:
    if _tuplet_actual_notes(note, ns) is None:
        return False
    stem_el = note.find(qname(ns, "stem"))
    stem = (stem_el.text or "").strip() if stem_el is not None and stem_el.text else ""
    if stem not in ("up", "down"):
        return False
    beam_side = "above" if stem == "up" else "below"
    removed = False
    for notations in list(note.findall(qname(ns, "notations"))):
        for arts in list(notations.findall(qname(ns, "articulations"))):
            for art in list(arts):
                if local_tag(art) == "staccato" and art.get("placement") == beam_side:
                    arts.remove(art)
                    removed = True
            if len(arts) == 0:
                notations.remove(arts)
        if len(notations) == 0:
            note.remove(notations)
    return removed


def _fix_tuplet_show_numbers(note: ET.Element, ns: str) -> bool:
    actual = _tuplet_actual_notes(note, ns)
    if actual is None:
        return False
    changed = False
    for notations in note.findall(qname(ns, "notations")):
        for tuplet in notations.findall(qname(ns, "tuplet")):
            if tuplet.get("type") != "start":
                continue
            if tuplet.get("show-number") == "actual":
                continue
            tuplet.set("show-number", "actual")
            if actual == 3 and not tuplet.get("placement"):
                tuplet.set("placement", "above")
            changed = True
    return changed


def fix_score_xml(xml_bytes: bytes) -> tuple[bytes, dict[str, int]]:
    tree = ET.parse(io.BytesIO(xml_bytes))
    root = tree.getroot()
    ns = mxl_ns_uri(root)
    parents = _parent_map(root)
    stats = {
        "text_nodes_cleared": 0,
        "directions_removed": 0,
        "natural_from_staccato_removed": 0,
        "slurs_injected": 0,
        "tuplet_show_number_fixed": 0,
        "tuplet_staccato_removed": 0,
    }

    for part in root.findall(qname(ns, "part")):
        for measure in part.findall(qname(ns, "measure")):
            tc, dr = _clean_measure(measure, ns, parents)
            stats["text_nodes_cleared"] += tc
            stats["directions_removed"] += dr

        for note in part.iter(qname(ns, "note")):
            if _remove_duplicate_staccato_as_natural(note, ns):
                stats["natural_from_staccato_removed"] += 1
            if _remove_beam_side_staccato_on_tuplet(note, ns):
                stats["tuplet_staccato_removed"] += 1
            if _fix_tuplet_show_numbers(note, ns):
                stats["tuplet_show_number_fixed"] += 1

        if _part_is_piano(part.get("id"), root, ns):
            stats["slurs_injected"] += _inject_missing_slurs_piano_m6(part, ns)

    out = ET.tostring(root, encoding="UTF-8", xml_declaration=True)
    return out, stats


def fix_mxl_file(mxl_in: str | Path, mxl_out: str | Path) -> dict[str, int]:
    mxl_in = Path(mxl_in)
    mxl_out = Path(mxl_out)
    totals = {
        "text_nodes_cleared": 0,
        "directions_removed": 0,
        "natural_from_staccato_removed": 0,
        "slurs_injected": 0,
        "tuplet_show_number_fixed": 0,
        "tuplet_staccato_removed": 0,
    }

    with zipfile.ZipFile(mxl_in, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    container_xml = files.get("META-INF/container.xml")
    if not container_xml:
        raise ValueError("Invalid MXL: no container.xml")

    match = re.search(r'full-path="([^"]+)"', container_xml.decode("utf-8"))
    if not match:
        raise ValueError("Could not find rootfile in container.xml")
    root_path = match.group(1)

    fixed_xml, stats = fix_score_xml(files[root_path])
    for k, v in stats.items():
        totals[k] = totals.get(k, 0) + v
    files[root_path] = fixed_xml

    with zipfile.ZipFile(mxl_out, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, data in files.items():
            zout.writestr(name, data)

    return totals


def fix_mxl_path_inplace(mxl_path: str | Path) -> dict[str, int]:
    """MXL 파일을 제자리에서 후처리 (Audiveris 직후·OMR 검토용)."""
    import os
    import shutil
    import tempfile

    mxl_path = Path(mxl_path)
    fd, tmp = tempfile.mkstemp(suffix=".mxl")
    os.close(fd)
    try:
        stats = fix_mxl_file(mxl_path, tmp)
        shutil.copyfile(tmp, mxl_path)
        return stats
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python fix_audiveris_mxl.py <mxl_in> [mxl_out]", file=sys.stderr)
        return 2
    if len(sys.argv) == 2:
        import json

        stats = fix_mxl_path_inplace(sys.argv[1])
        print(json.dumps({"path": sys.argv[1], **stats}, ensure_ascii=False))
        return 0
    stats = fix_mxl_file(sys.argv[1], sys.argv[2])
    print(
        "fix_audiveris_mxl: "
        f"text_nodes_cleared={stats['text_nodes_cleared']} "
        f"directions_removed={stats['directions_removed']} "
        f"natural_from_staccato_removed={stats['natural_from_staccato_removed']} "
        f"slurs_injected={stats.get('slurs_injected', 0)} "
        f"tuplet_show_number_fixed={stats.get('tuplet_show_number_fixed', 0)} "
        f"tuplet_staccato_removed={stats.get('tuplet_staccato_removed', 0)}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
