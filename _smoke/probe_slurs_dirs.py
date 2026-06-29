#!/usr/bin/env python3
"""Find all slurs and font/direction slur-like content."""
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

path = sys.argv[1]
with zipfile.ZipFile(path) as z:
    c = z.read("META-INF/container.xml").decode()
    rf = re.search(r'full-path="([^"]+)"', c).group(1)
    root = ET.parse(io.BytesIO(z.read(rf))).getroot()
m = re.match(r"\{(.*)\}", root.tag)
ns = m.group(1) if m else ""
q = lambda t: f"{{{ns}}}{t}" if ns else t

for part in root.findall(q("part")):
    if part.get("id") != "P5":
        continue
    for measure in part.findall(q("measure")):
        mn = measure.get("number")
        if mn not in {"6", "20", "30"}:
            continue
        print(f"\n=== P5 m{mn} ===")
        for d in measure.findall(q("direction")):
            st = d.find(q("staff"))
            sv = st.text if st is not None else "?"
            for dt in d.findall(q("direction-type")):
                for child in dt:
                    tag = child.tag.split("}")[-1]
                    attrs = dict(child.attrib)
                    text = (child.text or "").strip()
                    print(f"  direction staff={sv} {tag} attrs={attrs} text={text!r}")
        slur_count = 0
        for n in measure.findall(q("note")):
            st = n.find(q("staff"))
            if st is not None and st.text != "1":
                continue
            for s in n.findall(".//" + q("slur")):
                slur_count += 1
                p = n.find(q("pitch"))
                if p is not None:
                    step = p.find(q("step")).text
                    oct_ = p.find(q("octave")).text
                    print(f"  slur on {step}{oct_}: {s.attrib}")
        if slur_count == 0:
            print("  (no note slurs on staff 1)")
