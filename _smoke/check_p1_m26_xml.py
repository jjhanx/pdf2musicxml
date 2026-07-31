"""After HITL preview pipeline, verify P1 m26 notes in XML."""
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

# inline minimal pipeline via subprocess to node - use python only checks raw vs simple strip
raw = Path("_smoke/_0ea5_review.xml").read_text(encoding="utf-8")

def local(tag):
    return tag.split("}")[-1] if "}" in tag else tag

def p1_m26_notes(xml: str):
    root = ET.fromstring(xml)
    for p in root.iter():
        if local(p.tag) != "part" or p.get("id") != "P1":
            continue
        for m in p:
            if local(m.tag) != "measure" or m.get("number") != "26":
                continue
            out = []
            for n in m.iter():
                if local(n.tag) != "note":
                    continue
                if n.find(".//rest") is not None:
                    continue
                step = n.findtext(".//step")
                octv = n.findtext(".//octave")
                if step and octv:
                    out.append(f"{step}{octv}")
            return out
    return []

print("raw P1 m26", p1_m26_notes(raw))

# dangling removal only
import re
from xml.dom import minidom

# quick: count measure 26 in raw
for label, path in [("raw file", "_smoke/_0ea5_review.xml")]:
    xml = Path(path).read_text(encoding="utf-8")
    print(label, "width attr", bool(re.search(r'measure number="26"[^>]*width=', xml)))
    print(label, "P1 m26", p1_m26_notes(xml))
