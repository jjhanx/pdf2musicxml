#!/usr/bin/env python3
import io
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

zpath = Path("너에게 난 나에게 넌/omr-work-6cbf1add.zip")
with zipfile.ZipFile(zpath) as z:
    data = z.read(next(n for n in z.namelist() if "review.mxl" in n))
    with zipfile.ZipFile(io.BytesIO(data)) as mz:
        rf = re.search(r'full-path="([^"]+)"', mz.read("META-INF/container.xml").decode()).group(1)
        root = ET.fromstring(mz.read(rf))

for path, label in [
    (".//{*}note/{*}beam", "note>beam"),
    (".//{*}notations/{*}beam", "notations>beam"),
]:
    els = root.findall(path)
    print(label, len(els))

for part in root.findall(".//{*}part"):
    for meas in part.findall("{*}measure"):
        for n in meas.findall("{*}note"):
            beams = n.findall("{*}beam")
            if not beams:
                continue
            typ = n.find("{*}type")
            t = typ.text if typ is not None else "?"
            dur = n.find("{*}duration")
            d = int(dur.text) if dur is not None and dur.text else 0
            dot = n.find("{*}dot") is not None
            tm = n.find("{*}time-modification")
            if t in ("quarter", "half", "whole") or d >= 4 or dot:
                print(
                    part.get("id"),
                    "m" + meas.get("number"),
                    t,
                    "dur",
                    d,
                    "dot",
                    dot,
                    [b.text for b in beams],
                )
