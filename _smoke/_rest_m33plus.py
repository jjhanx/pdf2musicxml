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


def clef_at(part, mnum):
    cur = "G"
    for m in part.findall(q("measure")):
        mn = int(m.get("number"))
        if mn > mnum:
            break
        for attr in m.findall(q("attributes")):
            for c in attr.findall(q("clef")):
                if c.get("number", "1") == "1":
                    sign = c.find(q("sign"))
                    if sign is not None and sign.text:
                        cur = sign.text
    return cur


for pid in ["P1", "P2", "P3"]:
    part = root.find(f'.//{q("part")}[@id="{pid}"]')
    c = Counter()
    for m in part.findall(q("measure")):
        mn = int(m.get("number"))
        if mn < 33:
            continue
        cl = clef_at(part, mn)
        for note in m.findall(q("note")):
            rest = note.find(q("rest"))
            if rest is None:
                continue
            typ = note.find(q("type"))
            tval = (typ.text or "").strip() if typ is not None and typ.text else ""
            step = rest.find(q("display-step"))
            sval = (step.text or "").strip() if step is not None and step.text else ""
            octv = rest.find(q("display-octave"))
            oval = (octv.text or "").strip() if octv is not None and octv.text else ""
            c[(cl, tval, sval, oval)] += 1
    print(f"\n{pid} m33+:")
    for k, v in c.most_common(10):
        print(f"  {k} x{v}")
