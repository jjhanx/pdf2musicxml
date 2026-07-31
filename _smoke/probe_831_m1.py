#!/usr/bin/env python3
import io
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

zpath = Path(r"D:/pdf2musicxml/omr-work-8317959f.zip")
with zipfile.ZipFile(zpath) as z:
    data = z.read("audiveris_raw.mxl")
with zipfile.ZipFile(io.BytesIO(data)) as z:
    xml = z.read([n for n in z.namelist() if n.endswith(".xml") and "META" not in n.upper()][0])

root = ET.fromstring(xml)

def local(t):
    return t.split("}")[-1]

for part in root:
    if local(part.tag) != "part":
        continue
    pid = part.get("id")
    for i, meas in enumerate(part):
        if local(meas.tag) != "measure" or i >= 5:
            break
        attrs = []
        for attr in meas:
            if local(attr.tag) != "attributes":
                continue
            bits = []
            for c in attr:
                bits.append(local(c.tag))
            attrs.append(bits)
        print(f"{pid} m{meas.get('number')} attrs={attrs}")
