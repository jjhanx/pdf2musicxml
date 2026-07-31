#!/usr/bin/env python3
import xml.etree.ElementTree as ET

def local(t):
    return t.split("}", 1)[-1]

root = ET.parse("_smoke/_cheongsan_review.xml").getroot()
for pid in ["P1", "P2", "P3", "P4", "P5"]:
    part = root.find(f'.//{{*}}part[@id="{pid}"]')
    print("===", pid, "===")
    for n in ["24", "25", "26", "27", "28"]:
        m = next((x for x in part if local(x.tag) == "measure" and x.get("number") == n), None)
        if m is None:
            print(" m" + n, "MISSING")
            continue
        pitch = []
        for note in m.findall("{*}note"):
            p = note.find("{*}pitch")
            if p is None:
                pitch.append("R")
            else:
                pitch.append(p.find("{*}step").text + p.find("{*}octave").text)
        print(f" m{n}: {pitch}")
