#!/usr/bin/env python3
import xml.etree.ElementTree as ET

def local(t):
    return t.split("}", 1)[-1]

def summarize_meas(meas):
    rows = []
    for c in meas:
        tag = local(c.tag)
        if tag == "note":
            v = c.findtext("{*}voice") or "1"
            st = c.findtext("{*}staff") or "1"
            dur = c.findtext("{*}duration") or "?"
            typ = c.findtext("{*}type") or "?"
            p = c.find("{*}pitch")
            pitch = "R" if p is None else p.findtext("{*}step") + p.findtext("{*}octave")
            chord = c.find("{*}chord") is not None
            rows.append(f"note v{v} st{st} {pitch} {typ} d={dur}{' chord' if chord else ''}")
        elif tag in ("backup", "forward"):
            dur = c.findtext("{*}duration") or "?"
            rows.append(f"{tag} d={dur}")
        elif tag == "print":
            rows.append(f"print new-page={c.get('new-page')} new-system={c.get('new-system')}")
        elif tag == "attributes":
            rows.append("attributes")
    return rows

root = ET.parse("_smoke/_cheongsan_review.xml").getroot()
for pid in ["P1", "P3", "P5"]:
    part = root.find(f'.//{{*}}part[@id="{pid}"]')
    for n in ["25", "26", "27"]:
        m = next(x for x in part if local(x.tag) == "measure" and x.get("number") == n)
        print(f"\n{pid} m{n}:")
        for line in summarize_meas(m):
            print(" ", line)
