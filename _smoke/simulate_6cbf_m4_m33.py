#!/usr/bin/env python3
"""Simulate m4 PR/PL split + m33 repair for omr-work-6cbf1add."""
from __future__ import annotations

import io
import re
import zipfile
import xml.etree.ElementTree as ET
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
zpath = ROOT / "너에게 난 나에게 넌" / "omr-work-6cbf1add.zip"

with zipfile.ZipFile(zpath) as z:
    mxl = next(n for n in z.namelist() if "review.mxl" in n)
    data = z.read(mxl)
    with zipfile.ZipFile(io.BytesIO(data)) as mz:
        rf = re.search(r'full-path="([^"]+)"', mz.read("META-INF/container.xml").decode()).group(1)
        xml = mz.read(rf)

root = ET.fromstring(xml)


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
    for i, c in enumerate(measure):
        if local(c) not in ("attributes", "print"):
            insert_at = i
            break
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


def transform_verbatim(measure: ET.Element, staff_n: int, *, prune_flatten: bool) -> None:
    for child in list(measure):
        if local(child) == "note" and note_staff(child) != staff_n:
            measure.remove(child)
    for st in measure.findall(".//{*}note/{*}staff"):
        st.text = "1"
    if prune_flatten:
        prune_cross_staff_timeline(measure, staff_n)
        flatten_non_overlapping(measure)


def measure_timeline(measure: ET.Element) -> tuple[int, list[str]]:
    t = 0
    rows = []
    max_t = 0
    for child in measure:
        tag = local(child)
        if tag == "backup":
            d = dur_el(child)
            t -= d
            rows.append(f"backup {d} t={t}")
        elif tag == "forward":
            d = dur_el(child)
            t += d
            rows.append(f"forward {d} t={t}")
        elif tag == "note":
            rest = child.find("{*}rest") is not None
            dur = note_dur(child)
            chord = is_chord(child)
            if rest:
                typ = child.find("{*}type")
                rows.append(f"rest {typ.text if typ is not None else '?'} dur={dur} t={t}")
            else:
                p = child.find("{*}pitch")
                st = p.find("{*}step").text + p.find("{*}octave").text
                rows.append(f"note {st} dur={dur} t={t}{' CHORD' if chord else ''}")
            if not chord:
                t += dur
                max_t = max(max_t, t)
    return max_t, rows


def dump(label: str, measure: ET.Element) -> None:
    mt, rows = measure_timeline(measure)
    print(f"\n=== {label} max_t={mt} ===")
    for r in rows:
        print(" ", r)


p4 = next(p for p in root.findall(".//{*}part") if p.get("id") == "P4")
for mn in ["1", "4"]:
    m = next(x for x in p4.findall("{*}measure") if x.get("number") == mn)
    div = m.find(".//{*}divisions")
    beats = m.find(".//{*}beats")
    beat = m.find(".//{*}beat-type")
    print(
        f"m{mn} div={div.text if div is not None else '?'} "
        f"time={beats.text if beats is not None else '?'}/{beat.text if beat is not None else '?'}"
    )

m4 = next(m for m in p4.findall("{*}measure") if m.get("number") == "4")

for staff_n, name in ((1, "PR"), (2, "PL")):
    v = deepcopy(m4)
    transform_verbatim(v, staff_n, prune_flatten=False)
    dump(f"m4 {name} verbatim only", v)
    v2 = deepcopy(m4)
    transform_verbatim(v2, staff_n, prune_flatten=True)
    dump(f"m4 {name} verbatim+prune+flatten", v2)

# m33 piano staff1 pitch median
m33 = next(m for m in p4.findall("{*}measure") if m.get("number") == "33")
pitches = []
for n in m33.findall("{*}note"):
    if note_staff(n) == 1:
        p = n.find("{*}pitch")
        if p is not None:
            step = p.find("{*}step").text
            octv = int(p.find("{*}octave").text)
            sem = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}[step] + octv * 12
            pitches.append(sem)
print("\nP4 m33 staff1 pitch median:", sorted(pitches)[len(pitches) // 2])
