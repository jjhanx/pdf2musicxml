#!/usr/bin/env python3
"""Trace cheongsan preview pipeline: raw -> split simulation -> dangling counts."""
import copy
import xml.etree.ElementTree as ET
from pathlib import Path

def local(t):
    return t.split("}", 1)[-1]

def has_note_before(meas, idx):
    kids = list(meas)
    return any(local(kids[i].tag) == "note" for i in range(idx))

def has_note_after(meas, idx):
    kids = list(meas)
    return any(local(kids[i].tag) == "note" for i in range(idx + 1, len(kids)))

def remove_dangling(meas):
    n = 0
    for el in list(meas):
        if local(el.tag) not in ("backup", "forward"):
            continue
        idx = list(meas).index(el)
        if not has_note_before(meas, idx) or not has_note_after(meas, idx):
            meas.remove(el)
            n += 1
    return n

def strip_new_page(doc):
    for el in doc.iter():
        if local(el.tag) == "print" and el.get("new-page") == "yes":
            del el.attrib["new-page"]

def note_staff(note):
    st = note.findtext("{*}staff")
    return int(st) if st else 1

def split_part(part, staff_keep):
    p = copy.deepcopy(part)
    pid = p.get("id", "")
    p.set("id", f"{pid}__{'PR' if staff_keep == 1 else 'PL'}")
    for meas in p:
        if local(meas.tag) != "measure":
            continue
        for el in list(meas):
            if local(el.tag) == "note" and note_staff(el) != staff_keep:
                meas.remove(el)
        remove_dangling(meas)
    return p

def summarize(part, nums=(25, 26, 27)):
    pid = part.get("id", "?")
    for n in nums:
        m = next((x for x in part if local(x.tag) == "measure" and x.get("number") == str(n)), None)
        if not m:
            print(f"  {pid} m{n}: MISSING")
            continue
        pitches = []
        tags = []
        for c in m:
            t = local(c.tag)
            tags.append(t if t not in ("note",) else "note")
            if t == "note":
                p = c.find("{*}pitch")
                pitches.append("R" if p is None else p.findtext("{*}step") + p.findtext("{*}octave"))
        print(f"  {pid} m{n}: notes={pitches} tail={tags[-5:]}")

def main():
    raw = Path("_smoke/_cheongsan_review.xml").read_text(encoding="utf-8")
    root = ET.fromstring(raw)
    print("=== RAW P1 m25-27 ===")
    p1 = root.find('.//{*}part[@id="P1"]')
    summarize(p1)

    doc = ET.fromstring(raw)
    removed = 0
    for part in doc.iter():
        if local(part.tag) != "part":
            continue
        for meas in part:
            if local(meas.tag) == "measure":
                removed += remove_dangling(meas)
    strip_new_page(doc)
    print(f"\n=== AFTER cleanup (removed {removed} dangling) ===")
    p1c = doc.find('.//{*}part[@id="P1"]')
    summarize(p1c)

    p5 = doc.find('.//{*}part[@id="P5"]')
    print("\n=== AFTER split P5 -> PR/PL m25-27 ===")
    for sp in (split_part(p5, 1), split_part(p5, 2)):
        summarize(sp)

if __name__ == "__main__":
    main()
