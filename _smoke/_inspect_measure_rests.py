import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

mxl = Path(r"D:/pdf2musicxml/_smoke/omr-work-1b1b34df-full/review.mxl")
with zipfile.ZipFile(mxl) as z:
    root = ET.fromstring(z.read([n for n in z.namelist() if n.endswith(".xml") and "META" not in n][0]))
ns = root.tag.split("}")[0] + "}" if root.tag.startswith("{") else ""


def q(t):
    return f"{ns}{t}"


for pid in ["P1", "P2", "P3"]:
    part = root.find(f'.//{q("part")}[@id="{pid}"]')
    for note in part.iter():
        if note.tag.split("}")[-1] != "note":
            continue
        rest = note.find(q("rest"))
        if rest is None or rest.get("measure") != "yes":
            continue
        typ = note.find(q("type"))
        step = rest.find(q("display-step"))
        octv = rest.find(q("display-octave"))
        print(
            pid,
            "measure rest",
            "type",
            typ.text if typ is not None else None,
            "step",
            step.text if step is not None else None,
            "oct",
            octv.text if octv is not None else None,
        )
        break

    whole_half = []
    for note in part.iter():
        if note.tag.split("}")[-1] != "note":
            continue
        rest = note.find(q("rest"))
        if rest is None:
            continue
        typ = note.find(q("type"))
        tval = (typ.text or "").strip() if typ is not None else ""
        if tval not in ("whole", "half"):
            continue
        step = rest.find(q("display-step"))
        if step is not None and step.text:
            whole_half.append((tval, step.text.strip()))
    print(pid, "whole/half with display:", whole_half[:5])
