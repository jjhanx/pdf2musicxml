#!/usr/bin/env python3
"""Simulate P5 split to PR/PL and check m25-27 note counts."""
import xml.etree.ElementTree as ET

def local(t):
    return t.split("}", 1)[-1]

def note_staff(note):
    st = note.findtext("{*}staff")
    return int(st) if st else 1

def split_part(part, staff_keep):
    import copy
    p = copy.deepcopy(part)
    pid = p.get("id", "")
    p.set("id", f"{pid}__{'PR' if staff_keep == 1 else 'PL'}")
    for meas in p:
        if local(meas.tag) != "measure":
            continue
        for el in list(meas):
            if local(el.tag) == "note" and note_staff(el) != staff_keep:
                meas.remove(el)
        # remove dangling backup/forward at end
        for el in list(meas):
            if local(el.tag) not in ("backup", "forward"):
                continue
            idx = list(meas).index(el)
            has_after = any(local(list(meas)[j].tag) == "note" for j in range(idx + 1, len(meas)))
            has_before = any(local(list(meas)[j].tag) == "note" for j in range(0, idx))
            if not has_after or not has_before:
                meas.remove(el)
    return p

root = ET.parse("_smoke/_cheongsan_review.xml").getroot()
part = root.find('.//{*}part[@id="P5"]')
for label, staff in [("PR", 1), ("PL", 2)]:
    sp = split_part(part, staff)
    for n in ["25", "26", "27"]:
        m = next(x for x in sp if local(x.tag) == "measure" and x.get("number") == n)
        notes = m.findall("{*}note")
        pitch = []
        for note in notes:
            p = note.find("{*}pitch")
            pitch.append("R" if p is None else p.findtext("{*}step") + p.findtext("{*}octave"))
        print(f"P5__{label} m{n}: {len(notes)} {pitch[:8]}")
