#!/usr/bin/env python3
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

def local(t):
    return t.split("}", 1)[-1] if "}" in t else t

mxl = Path("청산에 살리라 F/_inspect_0ea5/review.mxl")
with zipfile.ZipFile(mxl) as z:
    root = ET.fromstring(z.read([n for n in z.namelist() if n.endswith(".xml") and "META" not in n][0]))

for pid in ["P1", "P2", "P3", "P4", "P5"]:
    part = None
    for p in root:
        if local(p.tag) == "part" and p.get("id") == pid:
            part = p
            break
    if part is None:
        continue
    for mn in range(24, 29):
        meas = None
        for m in part:
            if local(m.tag) == "measure" and m.get("number") == str(mn):
                meas = m
                break
        if meas is None:
            continue
        tags = []
        for c in meas:
            t = local(c.tag)
            if t == "note":
                tags.append("n")
            elif t == "backup":
                d = c.find(".//{*}duration")
                tags.append("b" + (d.text if d is not None else "?"))
            elif t == "forward":
                d = c.find(".//{*}duration")
                tags.append("f" + (d.text if d is not None else "?"))
            elif t == "print":
                tags.append("print")
            else:
                tags.append(t[:4])
        print(pid, "m" + str(mn), " ".join(tags))
