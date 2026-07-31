#!/usr/bin/env python3
import io
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

zpath = Path(r"D:/pdf2musicxml/omr-work-ddd2447d.zip")
with zipfile.ZipFile(zpath) as z:
    data = z.read("audiveris_raw.mxl")
with zipfile.ZipFile(io.BytesIO(data)) as z:
    xml = z.read([n for n in z.namelist() if n.endswith(".xml") and "META" not in n.upper()][0])
root = ET.fromstring(xml)

def local(t):
    return t.split("}")[-1]

part = [p for p in root if local(p.tag) == "part" and p.get("id") == "P1"][0]
for meas in part:
    n = int(meas.get("number") or 0)
    if n < 14 or n > 22:
        continue
    pr = meas.find("{*}print")
    pa = pr.attrib if pr is not None else {}
    keys = []
    for attr in meas:
        if local(attr.tag) != "attributes":
            continue
        for key in attr:
            if local(key.tag) == "key":
                f = next((c for c in key if local(c.tag) == "fifths"), None)
                keys.append(f.text if f is not None else "?")
    alters = 0
    for note in meas.findall(".//{*}note"):
        p = note.find("{*}pitch")
        if p is None:
            continue
        a = p.find("{*}alter")
        if a is not None and a.text:
            alters += 1
    print(f"m{n} print={pa} keys={keys} pitched_with_alter={alters}")
