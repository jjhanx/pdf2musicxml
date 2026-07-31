"""Check pickup and first measures in 0ea5"""
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

mxl = Path("청산에 살리라 F/_inspect_0ea5/review.mxl")
with zipfile.ZipFile(mxl) as z:
    root = ET.fromstring(z.read([n for n in z.namelist() if n.endswith(".xml") and "META" not in n][0]))

def local(tag):
    return tag.split("}")[-1] if "}" in tag else tag

for p in root.iter():
    if local(p.tag) != "part" or p.get("id") != "P1":
        continue
    nums = []
    for m in p:
        if local(m.tag) == "measure":
            nums.append(m.get("number"))
    print("P1 measure numbers first 5:", nums[:5])
    print("implicit measures:", [m.get("number") for m in p if local(m.tag)=="measure" and m.get("implicit")=="yes"])
