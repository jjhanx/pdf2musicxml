#!/usr/bin/env python3
"""Regression: omr-work-6cbf1add HITL preview fixes (m4 rests, m33 clef/key/pitch)."""
from __future__ import annotations

import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
zpath = ROOT / "너에게 난 나에게 넌" / "omr-work-6cbf1add.zip"
if not zpath.exists():
    print("skip: zip missing")
    sys.exit(0)

TREBLE_MIDI_MIN = 52
STEP_SEMI = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def load_xml() -> ET.Element:
    with zipfile.ZipFile(zpath) as z:
        data = z.read(next(n for n in z.namelist() if "review.mxl" in n))
        with zipfile.ZipFile(io.BytesIO(data)) as mz:
            rf = re.search(r'full-path="([^"]+)"', mz.read("META-INF/container.xml").decode()).group(1)
            return ET.fromstring(mz.read(rf))


def local(el) -> str:
    return el.tag.split("}")[-1] if "}" in el.tag else el.tag


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


def note_midi(note: ET.Element) -> int | None:
    p = note.find("{*}pitch")
    if p is None:
        return None
    step = p.find("{*}step").text
    octv = int(p.find("{*}octave").text)
    return (octv + 1) * 12 + STEP_SEMI[step]


def staff_timed_notes(measure: ET.Element):
    voice_cursor: dict[str, int] = {}
    last_note_voice = "1"
    out = []
    for child in measure:
        tag = local(child)
        if tag == "backup":
            v_el = child.find("{*}voice")
            v = v_el.text if v_el is not None and v_el.text else last_note_voice
            voice_cursor[v] = max(0, voice_cursor.get(v, 0) - dur_el(child))
        elif tag == "forward":
            v_el = child.find("{*}voice")
            v = v_el.text if v_el is not None and v_el.text else last_note_voice
            voice_cursor[v] = voice_cursor.get(v, 0) + dur_el(child)
        elif tag == "note":
            v = note_voice(child)
            last_note_voice = v
            t = voice_cursor.get(v, 0)
            dur = note_dur(child)
            end = t if is_chord(child) else t + dur
            out.append((child, t, v, end))
            if not is_chord(child):
                voice_cursor[v] = end
    return out


def voices_overlap(timed) -> bool:
    by_v: dict[str, list[tuple[int, int]]] = {}
    for _, tm, vn, end in timed:
        by_v.setdefault(vn, []).append((tm, end))
    voices = list(by_v)
    for i, a in enumerate(voices):
        for b in voices[i + 1 :]:
            for a0, a1 in by_v[a]:
                for b0, b1 in by_v[b]:
                    if max(a0, b0) < min(a1, b1):
                        return True
    return False


def prune_cross_staff_timeline(measure: ET.Element, staff_n: int) -> None:
    children = list(measure)
    for child in list(measure):
        tag = local(child)
        if tag not in ("backup", "forward"):
            continue
        idx = children.index(child)
        prev_staff = None
        for j in range(idx - 1, -1, -1):
            if local(children[j]) == "note":
                prev_staff = note_staff(children[j])
                break
        next_staff = None
        for j in range(idx + 1, len(children)):
            if local(children[j]) == "note":
                next_staff = note_staff(children[j])
                break
        if next_staff != staff_n:
            measure.remove(child)
            continue
        if tag in ("backup", "forward") and (prev_staff is None or prev_staff != staff_n):
            measure.remove(child)


def flatten_non_overlapping(measure: ET.Element) -> None:
    timed = staff_timed_notes(measure)
    if len(timed) < 2 or len({x[2] for x in timed}) < 2 or voices_overlap(timed):
        return
    for child in list(measure):
        if local(child) in ("note", "backup", "forward"):
            measure.remove(child)
    ns = measure.tag.split("}")[0].strip("{") if "}" in measure.tag else ""
    q = lambda name: f"{{{ns}}}{name}" if ns else name
    insert_at = 0
    cursor = 0
    for note, tm, _, _ in timed:
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
        measure.insert(insert_at, clone)
        insert_at += 1
        if not is_chord(clone):
            cursor = tm + note_dur(clone)


def needs_rebuild(measure: ET.Element) -> bool:
    for child in measure:
        if local(child) in ("backup", "forward"):
            return True
    voices = {note_voice(n) for n in measure.findall("{*}note")}
    return len(voices) > 1


def rebuild_single_voice(measure: ET.Element) -> None:
    timed = staff_timed_notes(measure)
    if not timed:
        return
    timed.sort(key=lambda x: x[1])
    for child in list(measure):
        if local(child) in ("note", "backup", "forward"):
            measure.remove(child)
    ns = measure.tag.split("}")[0].strip("{") if "}" in measure.tag else ""
    q = lambda name: f"{{{ns}}}{name}" if ns else name
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
            measure.insert(insert_at, clone)
            insert_at += 1
            if not is_chord(clone):
                slot_dur = max(slot_dur, note_dur(clone))
        cursor = start + slot_dur


def transform_staff(measure: ET.Element, staff_n: int) -> None:
    for child in list(measure):
        if local(child) == "note" and note_staff(child) != staff_n:
            measure.remove(child)
    for st in measure.findall(".//{*}note/{*}staff"):
        st.text = "1"
    prune_cross_staff_timeline(measure, staff_n)
    flatten_non_overlapping(measure)
    if needs_rebuild(measure):
        rebuild_single_voice(measure)


def measure_max_t(measure: ET.Element) -> int:
    t = 0
    for child in measure:
        tag = local(child)
        if tag == "backup":
            t -= dur_el(child)
        elif tag == "forward":
            t += dur_el(child)
        elif tag == "note" and not is_chord(child):
            t += note_dur(child)
    return t


def clef_sign_before(part: ET.Element, mnum: int, staff: int) -> str:
    cur = "G"
    for meas in part.findall("{*}measure"):
        mn = int(meas.get("number", "0"))
        if mn >= mnum:
            break
        for attr in meas.findall("{*}attributes"):
            for clef in attr.findall("{*}clef"):
                num = int(clef.get("number") or "1")
                if num != staff:
                    continue
                sign = clef.find("{*}sign")
                if sign is not None and sign.text:
                    cur = sign.text
    return cur


def median_pitch(measure: ET.Element, staff: int) -> float | None:
    midis = []
    for n in measure.findall("{*}note"):
        if note_staff(n) != staff:
            continue
        m = note_midi(n)
        if m is not None:
            midis.append(m)
    if not midis:
        return None
    midis.sort()
    mid = len(midis) // 2
    return midis[mid] if len(midis) % 2 else (midis[mid - 1] + midis[mid]) / 2


def repair_misread_f_clef(root: ET.Element) -> None:
    for part in root.findall(".//{*}part"):
        for meas in part.findall("{*}measure"):
            mnum = int(meas.get("number", "0"))
            for attr in list(meas.findall("{*}attributes")):
                for clef in list(attr.findall("{*}clef")):
                    sign = clef.find("{*}sign")
                    if sign is None or sign.text != "F":
                        continue
                    staff = int(clef.get("number") or "1")
                    if clef_sign_before(part, mnum, staff) != "G":
                        continue
                    med = median_pitch(meas, staff)
                    if med is not None and med < TREBLE_MIDI_MIN:
                        continue
                    attr.remove(clef)
                if len(attr) == 0:
                    meas.remove(attr)


def main() -> int:
    root = load_xml()
    p4 = next(p for p in root.findall(".//{*}part") if p.get("id") == "P4")
    m4 = deepcopy(next(m for m in p4.findall("{*}measure") if m.get("number") == "4"))
    for staff_n, label in ((1, "PR"), (2, "PL")):
        mm = deepcopy(m4)
        transform_staff(mm, staff_n)
        mt = measure_max_t(mm)
        has_backup = any(local(c) == "backup" for c in mm)
        voices = {note_voice(n) for n in mm.findall("{*}note")}
        print(f"m4 {label}: max_t={mt} backup={has_backup} voices={len(voices)}")
        if mt != 16 or has_backup or len(voices) != 1:
            print("  FAIL m4 timeline")
            return 1

    repair_misread_f_clef(root)
    for pid in ["P1", "P2", "P3"]:
        part = next(p for p in root.findall(".//{*}part") if p.get("id") == pid)
        m33 = next(m for m in part.findall("{*}measure") if m.get("number") == "33")
        f_clefs = m33.findall(".//{*}attributes/{*}clef/{*}sign")
        if any(s.text == "F" for s in f_clefs):
            print(f"{pid} m33: F clef still present")
            return 1
        note = m33.find("{*}note/{*}pitch")
        octv = int(note.find("{*}octave").text)
        if octv >= 5 and pid == "P1":
            print(f"{pid} m33: octave transposed too high ({octv})")
            return 1

    p4 = next(p for p in root.findall(".//{*}part") if p.get("id") == "P4")
    m33p = next(m for m in p4.findall("{*}measure") if m.get("number") == "33")
    f_on_st1 = False
    for clef in m33p.findall(".//{*}attributes/{*}clef"):
        if int(clef.get("number") or "1") == 1:
            sign = clef.find("{*}sign")
            if sign is not None and sign.text == "F":
                f_on_st1 = True
    if not f_on_st1:
        print("P4 m33 staff1: valid F clef removed")
        return 1

    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
