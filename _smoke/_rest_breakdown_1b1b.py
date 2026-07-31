import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

mxl = Path(r"D:/pdf2musicxml/_smoke/omr-work-1b1b34df-full/review.mxl")
with zipfile.ZipFile(mxl) as z:
    root = ET.fromstring(z.read([n for n in z.namelist() if n.endswith(".xml") and "META" not in n][0]))
ns = root.tag.split("}")[0] + "}" if root.tag.startswith("{") else ""


def q(t):
    return f"{ns}{t}"


for pid in ["P1", "P2", "P3"]:
    part = root.find(f'.//{q("part")}[@id="{pid}"]')
    c = Counter()
    for note in part.iter():
        if note.tag.split("}")[-1] != "note":
            continue
        rest = note.find(q("rest"))
        if rest is None:
            continue
        typ = note.find(q("type"))
        tval = (typ.text or "").strip() if typ is not None and typ.text else ""
        step = rest.find(q("display-step"))
        sval = (step.text or "").strip().upper() if step is not None and step.text else ""
        octv = rest.find(q("display-octave"))
        oval = (octv.text or "").strip() if octv is not None and octv.text else ""
        c[(tval, sval, oval, rest.get("measure"))] += 1
    print(f"\n{pid}:")
    for k, v in c.most_common(12):
        print(f"  {k} x{v}")
