#!/usr/bin/env python3
import io
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
zpath = ROOT / "너에게 난 나에게 넌" / "omr-work-6cbf1add.zip"
with zipfile.ZipFile(zpath) as z:
    mxl = next(n for n in z.namelist() if "review.mxl" in n)
    data = z.read(mxl)
    with zipfile.ZipFile(io.BytesIO(data)) as mz:
        rf = re.search(r'full-path="([^"]+)"', mz.read("META-INF/container.xml").decode()).group(1)
        xml = mz.read(rf)

root = ET.fromstring(xml)
ns = root.tag.split("}")[0].strip("{") if "}" in root.tag else ""


def q(t):
    return f"{{{ns}}}{t}" if ns else t


for pid in ["P1", "P2", "P3", "P4"]:
    p = root.find(f".//{q('part')}[@id='{pid}']")
    print("===", pid, "===")
    for mn in ["31", "32", "33", "34"]:
        m = p.find(f"{q('measure')}[@number='{mn}']")
        if m is None:
            continue
        print(f" m{mn}:")
        for el in m:
            tag = el.tag.split("}")[-1]
            if tag == "attributes":
                print(" ", ET.tostring(el, encoding="unicode")[:400])
            elif tag == "note":
                rest = el.find(q("rest"))
                pitch = el.find(q("pitch"))
                if rest is not None:
                    typ = el.find(q("type"))
                    print("  rest", typ.text if typ is not None else "?")
                else:
                    st = pitch.find(q("step")).text + pitch.find(q("octave")).text
                    print("  note", st)
            elif tag in ("backup", "forward"):
                print(" ", tag, el.find(q("duration")).text)
