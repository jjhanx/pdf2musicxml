#!/usr/bin/env python3
"""Full preview pipeline simulation + find ANY remaining OSMD-invalid beams."""
from __future__ import annotations

import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_review_xml(zpath: Path) -> ET.Element:
    with zipfile.ZipFile(zpath) as z:
        data = z.read(next(n for n in z.namelist() if "review.mxl" in n))
        with zipfile.ZipFile(io.BytesIO(data)) as mz:
            rf = re.search(r'full-path="([^"]+)"', mz.read("META-INF/container.xml").decode()).group(1)
            return ET.fromstring(mz.read(rf))


def local(el) -> str:
    return el.tag.split("}")[-1] if "}" in el.tag else el.tag


def qname(ns: str, tag: str) -> str:
    return f"{{{ns}}}{tag}" if ns else tag


def note_staff(note: ET.Element) -> int:
    st = note.find("{*}staff")
    return int(st.text) if st is not None and st.text else 1


def note_dur(note: ET.Element) -> int:
    d = note.find("{*}duration")
    return int(d.text) if d is not None and d.text else 0


def is_chord(note: ET.Element) -> bool:
    return note.find("{*}chord") is not None


def note_voice(note: ET.Element) -> str:
    v = note.find("{*}voice")
    return v.text if v is not None and v.text else "1"


def dur_el(el: ET.Element) -> int:
    d = el.find("{*}duration")
    return int(d.text) if d is not None and d.text else 0


def note_type(note: ET.Element) -> str:
    t = note.find("{*}type")
    return t.text if t is not None and t.text else ""


def strip_beams(note: ET.Element) -> None:
    for b in list(note.findall("{*}beam")):
        note.remove(b)


def running_divisions(part: ET.Element, measure: ET.Element) -> int:
    div = 4
    for meas in part.findall("{*}measure"):
        for attr in meas.findall("{*}attributes"):
            d = attr.find("{*}divisions")
            if d is not None and d.text and d.text.isdigit():
                div = int(d.text)
        if meas is measure:
            break
    return div if div > 0 else 4


def strip_invalid_beams_in_measure(measure: ET.Element, quarter_div: int) -> None:
    for note in measure.findall("{*}note"):
        typ = note_type(note)
        dur = note_dur(note)
        if (
            is_chord(note)
            or dur >= quarter_div
            or typ in ("quarter", "half", "whole", "breve", "long")
        ):
            strip_beams(note)


def staff_timed_notes(measure: ET.Element):
    voice_cursor: dict[str, int] = {}
    last = "1"
    out = []
    for child in measure:
        tag = local(child)
        if tag == "backup":
            v = child.find("{*}voice")
            v = v.text if v is not None and v.text else last
            voice_cursor[v] = max(0, voice_cursor.get(v, 0) - dur_el(child))
        elif tag == "forward":
            v = child.find("{*}voice")
            v = v.text if v is not None and v.text else last
            voice_cursor[v] = voice_cursor.get(v, 0) + dur_el(child)
        elif tag == "note":
            v = note_voice(child)
            last = v
            t = voice_cursor.get(v, 0)
            dur = note_dur(child)
            out.append((child, t, v))
            if not is_chord(child):
                voice_cursor[v] = t + dur
    return out


def voices_overlap(timed) -> bool:
    by_v: dict[str, list[tuple[int, int]]] = {}
    for _, tm, vn in timed:
        # compute end from original - simplified: use dur from note
        pass
    return False  # skip flatten overlap check for audit


def prune_cross_staff(measure: ET.Element, staff_n: int) -> None:
    children = list(measure)
    for child in list(measure):
        tag = local(child)
        if tag not in ("backup", "forward"):
            continue
        idx = children.index(child)
        prev_staff = next(
            (note_staff(children[j]) for j in range(idx - 1, -1, -1) if local(children[j]) == "note"),
            None,
        )
        next_staff = next(
            (note_staff(children[j]) for j in range(idx + 1, len(children)) if local(children[j]) == "note"),
            None,
        )
        if next_staff != staff_n:
            measure.remove(child)
        elif prev_staff != staff_n:
            measure.remove(child)


def flatten_non_overlapping(measure: ET.Element) -> None:
    timed = staff_timed_notes(measure)
    if len(timed) < 2 or len({x[2] for x in timed}) < 2:
        return
    by_v: dict[str, list[tuple[int, int]]] = {}
    voice_cursor: dict[str, int] = {}
    last = "1"
    for child in measure:
        tag = local(child)
        if tag == "backup":
            v = child.find("{*}voice")
            v = v.text if v is not None and v.text else last
            voice_cursor[v] = max(0, voice_cursor.get(v, 0) - dur_el(child))
        elif tag == "forward":
            v = child.find("{*}voice")
            v = v.text if v is not None and v.text else last
            voice_cursor[v] = voice_cursor.get(v, 0) + dur_el(child)
        elif tag == "note":
            v = note_voice(child)
            last = v
            t = voice_cursor.get(v, 0)
            dur = note_dur(child)
            end = t if is_chord(child) else t + dur
            by_v.setdefault(v, []).append((t, end))
            if not is_chord(child):
                voice_cursor[v] = end
    voices = list(by_v)
    for i, a in enumerate(voices):
        for b in voices[i + 1 :]:
            for a0, a1 in by_v[a]:
                for b0, b1 in by_v[b]:
                    if max(a0, b0) < min(a1, b1):
                        return
    for child in list(measure):
        if local(child) in ("note", "backup", "forward"):
            measure.remove(child)
    ns = measure.tag.split("}")[0].strip("{") if "}" in measure.tag else ""
    q = lambda n: f"{{{ns}}}{n}" if ns else n
    insert_at = 0
    cursor = 0
    for note, tm, _ in timed:
        if tm > cursor:
            fwd = ET.Element(q("forward"))
            ET.SubElement(fwd, q("duration")).text = str(tm - cursor)
            measure.insert(insert_at, fwd)
            insert_at += 1
            cursor = tm
        clone = deepcopy(note)
        v = clone.find("{*}voice")
        if v is not None:
            v.text = "1"
        qdiv = 4
        part = measure
        while part is not None and local(part) != "part":
            part = part.getparent() if hasattr(part, "getparent") else None
        measure.insert(insert_at, clone)
        insert_at += 1
        if not is_chord(clone):
            cursor = tm + note_dur(clone)


def needs_rebuild(measure: ET.Element) -> bool:
    if any(local(c) in ("backup", "forward") for c in measure):
        return True
    voices = {note_voice(n) for n in measure.findall("{*}note")}
    return len(voices) > 1


def rebuild_single_voice(measure: ET.Element, part: ET.Element) -> None:
    timed = staff_timed_notes(measure)
    if not timed:
        return
    timed.sort(key=lambda x: x[1])
    for child in list(measure):
        if local(child) in ("note", "backup", "forward"):
            measure.remove(child)
    ns = measure.tag.split("}")[0].strip("{") if "}" in measure.tag else ""
    q = lambda n: f"{{{ns}}}{n}" if ns else n
    qdiv = running_divisions(part, measure)
    insert_at = 0
    cursor = 0
    i = 0
    while i < len(timed):
        start = timed[i][1]
        if start > cursor:
            fwd = ET.Element(q("forward"))
            ET.SubElement(fwd, q("duration")).text = str(start - cursor)
            measure.insert(insert_at, fwd)
            insert_at += 1
            cursor = start
        group = []
        while i < len(timed) and timed[i][1] == start:
            group.append(timed[i])
            i += 1
        slot_dur = 0
        for j, item in enumerate(group):
            clone = deepcopy(item[0])
            v = clone.find("{*}voice")
            if v is not None:
                v.text = "1"
            if j > 0:
                ET.SubElement(clone, q("chord"))
                strip_beams(clone)
            if note_dur(clone) >= qdiv:
                strip_beams(clone)
            measure.insert(insert_at, clone)
            insert_at += 1
            if not is_chord(clone):
                slot_dur = max(slot_dur, note_dur(clone))
        cursor = start + slot_dur


def transform_measure_staff(measure: ET.Element, staff_n: int, part: ET.Element) -> None:
    for c in list(measure):
        if local(c) == "note" and note_staff(c) != staff_n:
            measure.remove(c)
    for st in measure.findall(".//{*}note/{*}staff"):
        st.text = "1"
    prune_cross_staff(measure, staff_n)
    flatten_non_overlapping(measure)
    if needs_rebuild(measure):
        rebuild_single_voice(measure, part)


def max_staves(part: ET.Element) -> int:
    mx = 1
    for m in part.findall("{*}measure"):
        for st in m.findall(".//{*}staves"):
            if st.text and st.text.isdigit():
                mx = max(mx, int(st.text))
        for st in m.findall(".//{*}note/{*}staff"):
            if st.text and st.text.isdigit():
                mx = max(mx, int(st.text))
    return mx


def split_grand_staff(root: ET.Element) -> ET.Element:
    root = deepcopy(root)
    ns = root.tag.split("}")[0].strip("{") if "}" in root.tag else ""
    part_list = root.find(f".//{qname(ns, 'part-list')}")
    for part in list(root.findall(f".//{qname(ns, 'part')}")):
        pid = part.get("id")
        if not pid or pid.endswith("__PR") or pid.endswith("__PL"):
            continue
        if max_staves(part) < 2:
            continue
        pr = deepcopy(part)
        pl = deepcopy(part)
        pr.set("id", f"{pid}__PR")
        pl.set("id", f"{pid}__PL")
        for meas in pr.findall("{*}measure"):
            transform_measure_staff(meas, 1, pr)
        for meas in pl.findall("{*}measure"):
            transform_measure_staff(meas, 2, pl)
        parent = part.getparent() if hasattr(part, "getparent") else None
        # ElementTree: find parent manually
        for parent_el in root.iter():
            if part in list(parent_el):
                idx = list(parent_el).index(part)
                parent_el.remove(part)
                parent_el.insert(idx, pr)
                parent_el.insert(idx + 1, pl)
                break
        if part_list is not None:
            sp = next(
                (c for c in part_list if local(c) == "score-part" and c.get("id") == pid),
                None,
            )
            if sp is not None:
                def clone_sp(new_id: str) -> ET.Element:
                    n = deepcopy(sp)
                    n.set("id", new_id)
                    return n

                idx = list(part_list).index(sp)
                part_list.remove(sp)
                part_list.insert(idx, clone_sp(f"{pid}__PR"))
                part_list.insert(idx + 1, clone_sp(f"{pid}__PL"))
    return root


def osmd_beam_invalid(note: ET.Element, quarter_div: int) -> bool:
    if not note.findall("{*}beam"):
        return False
    if note.find("{*}rest") is not None:
        return True
    typ = note_type(note)
    dur = note_dur(note)
    if is_chord(note):
        return True
    if typ in ("quarter", "half", "whole", "breve", "long"):
        return True
    if dur >= quarter_div:
        return True
    # OSMD may treat dotted quarter as >= quarter
    if dur * 2 >= quarter_div * 3 and dur >= quarter_div:  # redundant
        return True
    return False


def audit_root(root: ET.Element, label: str) -> list[str]:
    bad = []
    for part in root.findall(".//{*}part"):
        pid = part.get("id")
        for meas in part.findall("{*}measure"):
            mn = meas.get("number")
            qdiv = running_divisions(part, meas)
            strip_invalid_beams_in_measure(meas, qdiv)
            for note in meas.findall("{*}note"):
                if osmd_beam_invalid(note, qdiv):
                    typ = note_type(note)
                    dur = note_dur(note)
                    beams = [b.text for b in note.findall("{*}beam")]
                    pitch = note.find("{*}pitch")
                    nm = (
                        pitch.find("{*}step").text + pitch.find("{*}octave").text
                        if pitch is not None
                        else "rest"
                    )
                    bad.append(f"{label} {pid} m{mn} {nm} type={typ} dur={dur}/{qdiv} beams={beams} chord={is_chord(note)}")
    return bad


def main() -> int:
    zips = [
        ROOT / "너에게 난 나에게 넌" / "omr-work-6cbf1add.zip",
        ROOT / "omr-work-6cbf1add.zip",
        ROOT / "omr-work-0a5a7d84.zip",
    ]
    zpath = next((z for z in zips if z.exists()), None)
    if not zpath:
        print("no zip")
        return 1
    raw = load_review_xml(zpath)
    bad_raw = audit_root(deepcopy(raw), "RAW+strip")
    split = split_grand_staff(raw)
    bad_split = audit_root(split, "SPLIT+strip")
    print(f"zip={zpath.name}")
    print(f"after strip on raw: {len(bad_raw)} invalid beams")
    for x in bad_raw[:15]:
        print(" ", x)
    print(f"after split+strip: {len(bad_split)} invalid beams")
    for x in bad_split[:30]:
        print(" ", x)
    return 1 if bad_split or bad_raw else 0


if __name__ == "__main__":
    sys.exit(main())
