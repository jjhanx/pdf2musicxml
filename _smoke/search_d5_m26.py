"""Search for D5 sequence in 0ea5 review.mxl"""
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

mxl = Path("청산에 살리라 F/_inspect_0ea5/review.mxl")
with zipfile.ZipFile(mxl) as z:
    xml_name = next(n for n in z.namelist() if n.endswith(".xml") and "META" not in n)
    root = ET.fromstring(z.read(xml_name))

def local(tag):
    return tag.split("}")[-1] if "}" in tag else tag

for pid in ("P1",):
    for p in root.iter():
        if local(p.tag) != "part" or p.get("id") != pid:
            continue
        for m in p:
            if local(m.tag) != "measure":
                continue
            mn = m.get("number")
            pitches = []
            for n in m.iter():
                if local(n.tag) != "note":
                    continue
                if n.find(".//rest") is not None:
                    continue
                step = n.findtext(".//step")
                octv = n.findtext(".//octave")
                if step and octv:
                    pitches.append(f"{step}{octv}")
            if mn and int(mn) >= 24 and int(mn) <= 30:
                print(f"P1 m{mn}: {' '.join(pitches)}")
