#!/usr/bin/env python3
import re, zipfile, xml.etree.ElementTree as ET
from pathlib import Path

p = Path("_smoke/6cbf_full_fixed.mxl")
with zipfile.ZipFile(p) as z:
    c = z.read("META-INF/container.xml").decode()
    rf = re.search(r'full-path="([^"]+)"', c).group(1)
    root = ET.fromstring(z.read(rf))
ns = root.tag.split("}")[0].strip("{") if "}" in root.tag else ""
q = lambda t: f"{{{ns}}}{t}"


def lt(el):
    return el.tag.split("}")[-1]


d_count = 0
no_type = 0
for note in root.iter():
    if lt(note) != "note":
        continue
    rest = note.find(q("rest"))
    if rest is None:
        continue
    ds = rest.find(q("display-step"))
    typ = note.find(q("type"))
    if ds is not None and ds.text == "D":
        d_count += 1
        if d_count <= 8:
            print(
                "D rest",
                "type=" + (typ.text if typ is not None else "NONE"),
                "measure=" + str(rest.get("measure")),
                "dur=" + (note.find(q("duration")).text if note.find(q("duration")) is not None else "?"),
            )
    if typ is None and ds is not None:
        no_type += 1

print("total D display", d_count, "no_type_with_display", no_type)
