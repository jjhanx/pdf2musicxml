#!/usr/bin/env python3
import zipfile
import xml.etree.ElementTree as ET

with zipfile.ZipFile("청산에 살리라 F/_inspect_0ea5/review.mxl") as z:
    root = ET.fromstring(z.read([n for n in z.namelist() if n.endswith(".xml")][0]))
part = root.find(".//{*}part[@id='P1']")
for mn in ("25", "26", "27"):
    m = part.find(f".//{{*}}measure[@number='{mn}']")
    print("=== m", mn)
    for c in m:
        tag = c.tag.split("}")[-1]
        if tag in ("attributes", "print", "barline", "direction"):
            print(tag, ET.tostring(c, encoding="unicode")[:300])
    for n in m.findall("{*}note"):
        print(ET.tostring(n, encoding="unicode")[:500])
