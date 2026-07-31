#!/usr/bin/env python3
import re, zipfile, xml.etree.ElementTree as ET
from pathlib import Path

RAW = Path("_smoke/_6cbf_final/audiveris_raw.mxl")
with zipfile.ZipFile(RAW) as z:
    c = z.read("META-INF/container.xml").decode()
    rf = re.search(r'full-path="([^"]+)"', c).group(1)
    root = ET.fromstring(z.read(rf))
ns = root.tag.split("}")[0].strip("{") if "}" in root.tag else ""
q = lambda t: f"{{{ns}}}{t}"
lt = lambda el: el.tag.split("}")[-1]

for mn in ["33", "34", "35"]:
    print(f"\n==== measure {mn} ====")
    for part in root.findall(q("part")):
        pid = part.get("id")
        meas = next((m for m in part.findall(q("measure")) if m.get("number") == mn), None)
        if meas is None:
            continue
        attrs = []
        for el in meas:
            if lt(el) == "attributes":
                for c in el:
                    ct = lt(c)
                    if ct == "clef":
                        sign = c.find(q("sign"))
                        attrs.append(f"clef={sign.text if sign is not None else '?'}")
                    elif ct == "key":
                        f = c.find(q("fifths"))
                        attrs.append(f"key={f.text if f is not None else '?'}")
        if attrs:
            print(f"  {pid}: " + ", ".join(attrs))
