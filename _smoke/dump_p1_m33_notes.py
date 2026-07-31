#!/usr/bin/env python3
import zipfile, re, xml.etree.ElementTree as ET
from pathlib import Path

p = Path("_smoke/_6cbf_final/audiveris_raw.mxl")
with zipfile.ZipFile(p) as z:
    c = z.read("META-INF/container.xml").decode()
    rf = re.search(r'full-path="([^"]+)"', c).group(1)
    root = ET.fromstring(z.read(rf))
ns = root.tag.split("}")[0].strip("{") if "}" in root.tag else ""
q = lambda t: f"{{{ns}}}{t}"
part = root.findall(q("part"))[0]
meas = next(m for m in part.findall(q("measure")) if m.get("number") == "33")
for el in meas:
    if el.tag.split("}")[-1] != "note":
        continue
    pitch = el.find(q("pitch"))
    staff = el.find(q("staff"))
    voice = el.find(q("voice"))
    print(ET.tostring(el, encoding="unicode")[:300])
