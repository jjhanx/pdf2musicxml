#!/usr/bin/env python3
import io
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

zpath = Path(r"D:/pdf2musicxml/omr-work-ddd2447d.zip")
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
    events = []
    for meas in part:
        if local(meas.tag) != "measure":
            continue
        pr = meas.find("{*}print")
        br = pr is not None and (pr.get("new-system") == "yes" or pr.get("new-page") == "yes")
        for attr in meas:
            if local(attr.tag) != "attributes":
                continue
            for key in attr:
                if local(key.tag) != "key":
                    continue
                f = next((c for c in key if local(c.tag) == "fifths"), None)
                if f is not None and f.text:
                    events.append((int(meas.get("number")), int(f.text), br))
    by_f = defaultdict(list)
    for m, f, br in events:
        by_f[f].append((m, br))
    print(pid, dict(by_f))
