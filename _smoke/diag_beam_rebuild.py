#!/usr/bin/env python3
"""Find notes with beam on quarter+ after staff split rebuild pattern."""
import io
import re
import zipfile
import xml.etree.ElementTree as ET
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
zpath = ROOT / "너에게 난 나에게 넌" / "omr-work-6cbf1add.zip"
if not zpath.exists():
    zpath = ROOT / "omr-work-6cbf1add.zip"

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
            out.append((child, t, v, t if is_chord(child) else t + dur))
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
            measure.insert(insert_at, clone)
            insert_at += 1
            if not is_chord(clone):
                slot_dur = max(slot_dur, note_dur(clone))
        cursor = start + slot_dur


def check_beam_issues(measure, label):
    div = 4  # m1 default
    for child in measure:
        if local(child) != "note":
            continue
        typ = child.find("{*}type")
        beams = child.findall("{*}beam")
        if not beams:
            continue
        t = typ.text if typ is not None else "?"
        dur = note_dur(child)
        if t in ("quarter", "half", "whole") or dur >= div:
            pitch = child.find("{*}pitch")
            step = pitch.find("{*}step").text + pitch.find("{*}octave").text if pitch is not None else "rest"
            print(f"  BAD {label}: {step} type={t} dur={dur} beams={[b.text for b in beams]}")


p4 = next(p for p in root.findall(".//{*}part") if p.get("id") == "P4")
for mn in ["4", "32", "33"]:
    m = deepcopy(next(x for x in p4.findall("{*}measure") if x.get("number") == mn))
    print(f"\n=== m{mn} RAW staff1 ===")
    for staff_n in (1, 2):
        mm = deepcopy(m)
        for c in list(mm):
            if local(c) == "note" and note_staff(c) != staff_n:
                mm.remove(c)
        prune_cross_staff(mm, staff_n)
        rebuild_single_voice(mm)
        check_beam_issues(mm, f"staff{staff_n} after rebuild")
