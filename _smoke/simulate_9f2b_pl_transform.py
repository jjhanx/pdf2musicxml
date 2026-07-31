#!/usr/bin/env python3
"""Simulate AudiverisInspectPanel transformMeasureToSingleStaff for 9f2b m2."""
import io
import zipfile
import xml.etree.ElementTree as ET
from copy import deepcopy
from pathlib import Path

ZIP = Path(r"D:/pdf2musicxml/omr-work-9f2b6020.zip")


def local(el):
    return el.tag.split("}")[-1] if "}" in el.tag else el.tag


def note_staff(note):
    st = note.find("{*}staff")
    return int(st.text) if st is not None and st.text else 1


def prune_cross_staff_timeline(measure, staff_n):
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
            child.getparent().remove(child) if hasattr(child, "getparent") else measure.remove(child)
            continue
        if tag in ("backup", "forward") and (prev_staff is None or prev_staff != staff_n):
            measure.remove(child)


def flatten_non_overlapping(measure):
    t = 0
    timed = []
    for child in measure:
        tag = local(child)
        if tag == "backup":
            d = int(child.find("{*}duration").text)
            t = max(0, t - d)
        elif tag == "forward":
            d = int(child.find("{*}duration").text)
            t += d
        elif tag == "note":
            dur = int(child.find("{*}duration").text)
            chord = child.find("{*}chord") is not None
            voice = child.find("{*}voice")
            vn = voice.text if voice is not None else "1"
            end = t if chord else t + dur
            timed.append((child, t, vn, end))
            if not chord:
                t = end
    if len(timed) < 2:
        return measure
    if len({x[2] for x in timed}) < 2:
        return measure
    # overlap check
    by_v = {}
    for _, tm, vn, end in timed:
        by_v.setdefault(vn, []).append((tm, end))
    voices = list(by_v)
    for i in range(len(voices)):
        for j in range(i + 1, len(voices)):
            for a0, a1 in by_v[voices[i]]:
                for b0, b1 in by_v[voices[j]]:
                    if max(a0, b0) < min(a1, b1):
                        return measure
    m = deepcopy(measure)
    for child in list(m):
        if local(child) in ("note", "backup", "forward"):
            m.remove(child)
    cursor = 0
    ns = m.tag.split("}")[0].strip("{") if "}" in m.tag else ""
    q = lambda name: f"{{{ns}}}{name}" if ns else name

    def insert_at():
        for i, c in enumerate(m):
            loc = local(c)
            if loc in ("attributes", "print"):
                continue
            if loc == "barline" and c.get("location") == "right":
                continue
            return i
        return len(m)

    idx = insert_at()
    for note, tm, _, _ in timed:
        if tm > cursor:
            fwd = ET.Element(q("forward"))
            ET.SubElement(fwd, q("duration")).text = str(tm - cursor)
            m.insert(idx, fwd)
            idx += 1
            cursor = tm
        clone = deepcopy(note)
        v = clone.find("{*}voice")
        if v is not None:
            v.text = "1"
        m.insert(idx, clone)
        idx += 1
        if clone.find("{*}chord") is None:
            cursor = tm + int(clone.find("{*}duration").text)
    return m


def transform_measure(measure, staff_n):
    m = deepcopy(measure)
    for child in list(m):
        if local(child) == "note" and note_staff(child) != staff_n:
            m.remove(child)
    prune_cross_staff_timeline(m, staff_n)
    return flatten_non_overlapping(m)


def dump_timeline(measure, label):
    print(f"\n=== {label} ===")
    t = 0
    idx = 0
    for child in measure:
        tag = local(child)
        if tag == "backup":
            d = int(child.find("{*}duration").text)
            t -= d
            print(f"  backup dur={d} t->{t}")
        elif tag == "forward":
            d = int(child.find("{*}duration").text)
            t += d
            print(f"  forward dur={d} t->{t}")
        elif tag == "note":
            idx += 1
            dur = int(child.find("{*}duration").text)
            chord = child.find("{*}chord") is not None
            pitch = child.find("{*}pitch")
            pname = "rest"
            if pitch is not None:
                step = pitch.find("{*}step").text
                oct = pitch.find("{*}octave").text
                pname = f"{step}{oct}"
            dx = child.get("default-x", "")
            print(f"  #{idx} t={t} dur={dur} dx={dx} {pname}{' CHORD' if chord else ''}")
            if not chord:
                t += dur


with zipfile.ZipFile(ZIP) as z:
    data = z.read("audiveris_raw.mxl")
with zipfile.ZipFile(io.BytesIO(data)) as z:
    xml = z.read([n for n in z.namelist() if n.endswith(".xml") and "META" not in n.upper()][0])

root = ET.fromstring(xml)
p4 = next(p for p in root.findall(".//{*}part") if p.get("id") == "P4")
m2 = next(m for m in p4.findall("{*}measure") if m.get("number") == "2")

dump_timeline(m2, "RAW P4 m2")
dump_timeline(transform_measure(m2, 1), "PR transform")
dump_timeline(transform_measure(m2, 2), "PL transform")

# Count PR pitches including chords at each t
print("\n=== PR pitch count by t ===")
pr = transform_measure(m2, 1)
t = 0
count = 0
for child in pr:
    if local(child) != "note":
        continue
    dur = int(child.find("{*}duration").text)
    chord = child.find("{*}chord") is not None
    count += 1
    print(f"  pitch #{count} t={t}")
    if not chord:
        t += dur

print("\n=== PL note count by t ===")
pl = transform_measure(m2, 2)
t = 0
count = 0
for child in pl:
    tag = local(child)
    if tag == "backup":
        t -= int(child.find("{*}duration").text)
    elif tag == "forward":
        t += int(child.find("{*}duration").text)
    elif tag == "note":
        dur = int(child.find("{*}duration").text)
        chord = child.find("{*}chord") is not None
        count += 1
        print(f"  note #{count} t={t}")
        if not chord:
            t += dur
