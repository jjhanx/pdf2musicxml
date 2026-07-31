#!/usr/bin/env python3
"""Scan all measures after PR/PL split+rebuild for invalid beams."""
import io
import re
import zipfile
import xml.etree.ElementTree as ET
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
for zpath in [
    ROOT / "너에게 난 나에게 넌" / "omr-work-6cbf1add.zip",
    ROOT / "omr-work-6cbf1add.zip",
    ROOT / "omr-work-0a5a7d84.zip",
]:
    if zpath.exists():
        break
else:
    raise SystemExit("no zip")

with zipfile.ZipFile(zpath) as z:
    data = z.read(next(n for n in z.namelist() if "review.mxl" in n))
    with zipfile.ZipFile(io.BytesIO(data)) as mz:
        rf = re.search(r'full-path="([^"]+)"', mz.read("META-INF/container.xml").decode()).group(1)
        root = ET.fromstring(mz.read(rf))


def local(el) -> str:
    return el.tag.split("}")[-1] if "}" in el.tag else el.tag


def note_staff(note):
    st = note.find("{*}staff")
    return int(st.text) if st is not None and st.text else 1


def note_dur(note):
    d = note.find("{*}duration")
    return int(d.text) if d is not None and d.text else 0


def is_chord(note):
    return note.find("{*}chord") is not None


def note_voice(note):
    v = note.find("{*}voice")
    return v.text if v is not None and v.text else "1"


def dur_el(el):
    d = el.find("{*}duration")
    return int(d.text) if d is not None and d.text else 0


def staff_timed_notes(measure):
    voice_cursor = {}
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


def prune_cross_staff(measure, staff_n):
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


def rebuild_single_voice(measure):
    timed = staff_timed_notes(measure)
    if not timed:
        return
    timed.sort(key=lambda x: x[1])
    for child in list(measure):
        if local(child) in ("note", "backup", "forward"):
            measure.remove(child)
    ns = measure.tag.split("}")[0].strip("{") if "}" in measure.tag else ""
    q = lambda n: f"{{{ns}}}{n}" if ns else n
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
                for b in clone.findall("{*}beam"):
                    clone.remove(b)
            dur = note_dur(clone)
            if dur >= 4:
                for b in clone.findall("{*}beam"):
                    clone.remove(b)
            measure.insert(insert_at, clone)
            insert_at += 1
            if not is_chord(clone):
                slot_dur = max(slot_dur, note_dur(clone))
        cursor = start + slot_dur


def max_staves(part):
    mx = 1
    for m in part.findall("{*}measure"):
        for st in m.findall(".//{*}staves"):
            if st.text and st.text.isdigit():
                mx = max(mx, int(st.text))
        for st in m.findall(".//{*}note/{*}staff"):
            if st.text and st.text.isdigit():
                mx = max(mx, int(st.text))
    return mx


def transform_staff_measure(measure, staff_n):
    for c in list(measure):
        if local(c) == "note" and note_staff(c) != staff_n:
            measure.remove(c)
    prune_cross_staff(measure, staff_n)
    # skip flatten for simplicity — rebuild is what triggers after needs_rebuild
    rebuild_single_voice(measure)


issues = []
for part in root.findall(".//{*}part"):
    pid = part.get("id")
    if max_staves(part) < 2:
        continue
    for staff_n in (1, 2):
        suffix = "PR" if staff_n == 1 else "PL"
        for meas in part.findall("{*}measure"):
            mn = meas.get("number")
            mm = deepcopy(meas)
            transform_staff_measure(mm, staff_n)
            for note in mm.findall("{*}note"):
                beams = note.findall("{*}beam")
                if not beams:
                    continue
                typ = note.find("{*}type")
                t = typ.text if typ is not None else ""
                dur = note_dur(note)
                chord = is_chord(note)
                bad = t in ("quarter", "half", "whole") or dur >= 4
                if bad:
                    pitch = note.find("{*}pitch")
                    nm = (
                        pitch.find("{*}step").text + pitch.find("{*}octave").text
                        if pitch is not None
                        else "rest"
                    )
                    issues.append(
                        f"{pid}__{suffix} m{mn} {nm} type={t} dur={dur} chord={chord} beams={[b.text for b in beams]}"
                    )

print(f"zip={zpath.name} issues={len(issues)}")
for line in issues[:40]:
    print(line)
