import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

mxl = Path(r"D:\pdf2musicxml\_smoke\_6cbf_final\review.mxl")
with zipfile.ZipFile(mxl) as z:
    xml_name = [n for n in z.namelist() if n.endswith(".xml") and "META" not in n][0]
    root = ET.fromstring(z.read(xml_name))

ns = ""
if root.tag.startswith("{"):
    ns = root.tag.split("}")[0] + "}"


def q(t):
    return f"{ns}{t}"


def local(tag):
    return tag.split("}")[-1] if "}" in tag else tag


for part in root.findall(f".//{q('part')}"):
    pid = part.get("id")
    rests = []
    for note in part.iter():
        if local(note.tag) != "note":
            continue
        rest = note.find(q("rest"))
        if rest is None:
            continue
        typ = note.find(q("type"))
        tval = (typ.text or "").strip() if typ is not None else ""
        step = rest.find(q("display-step"))
        octv = rest.find(q("display-octave"))
        sval = (step.text or "").strip() if step is not None else None
        oval = (octv.text or "").strip() if octv is not None else None
        if sval:
            rests.append((tval, sval, oval, rest.get("measure")))
    if rests:
        c = Counter(rests)
        print(f"Part {pid}: {len(rests)} rests with display-step")
        for k, v in sorted(c.items(), key=lambda x: -x[1])[:15]:
            print(f"  {k} x{v}")
