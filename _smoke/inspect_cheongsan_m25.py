#!/usr/bin/env python3
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

def loc(t):
    return t.split("}", 1)[-1]

def inspect_part(root, pid, mnums=(25, 26, 27)):
    part = root.find(f'.//{{*}}part[@id="{pid}"]')
    if part is None:
        print(pid, "MISSING PART")
        return
    for n in mnums:
        m = next((x for x in part if loc(x.tag) == "measure" and x.get("number") == str(n)), None)
        if not m:
            print(pid, f"m{n}", "MISSING")
            continue
        notes = []
        tags = []
        for c in m:
            t = loc(c.tag)
            tags.append(t)
            if t == "note":
                p = c.find("{*}pitch")
                notes.append("R" if p is None else p.findtext("{*}step") + p.findtext("{*}octave"))
        print(pid, f"m{n}", "notes", notes, "backup", tags.count("backup"))

p = Path(r"D:/pdf2musicxml/청산에 살리라 F/_inspect_0ea5/review.mxl")
with zipfile.ZipFile(p) as z:
    x = [n for n in z.namelist() if n.endswith(".xml")][0]
    root = ET.fromstring(z.read(x))
for pid in ["P1", "P2", "P3", "P4", "P5"]:
    inspect_part(root, pid)
