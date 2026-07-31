"""Inspect measure width/print on m24-28 in 0ea5 review.mxl"""
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

mxl = Path("청산에 살리라 F/_inspect_0ea5/review.mxl")
with zipfile.ZipFile(mxl) as z:
    xml_name = next(n for n in z.namelist() if n.endswith(".xml") and "META" not in n)
    xml = z.read(xml_name).decode()

for mn in (24, 25, 26, 27, 28):
    m = re.search(rf'<measure number="{mn}"[^>]*>', xml)
    if m:
        tag = m.group(0)
        w = re.search(r'width="([^"]+)"', tag)
        print(f"m{mn}: {tag} width={w.group(1) if w else None}")
    else:
        print(f"m{mn}: MISSING")

root = ET.fromstring(xml)

def local(tag):
    return tag.split("}")[-1] if "}" in tag else tag

for pid in ("P1", "P5"):
    for p in root.iter():
        if local(p.tag) != "part" or p.get("id") != pid:
            continue
        for m in p:
            if local(m.tag) != "measure" or m.get("number") != "25":
                continue
            backs = [c for c in m if local(c) == "backup"]
            prints = [c for c in m if local(c) == "print"]
            print(f"{pid} m25: backups={len(backs)} prints={len(prints)} last={local(m[-1])}")
