import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

mxl = Path(r"D:\pdf2musicxml\_smoke\omr-work-1b1b34df-full\review.mxl")
with zipfile.ZipFile(mxl) as z:
    xml_name = [n for n in z.namelist() if n.endswith(".xml") and "META" not in n][0]
    root = ET.fromstring(z.read(xml_name))

ns = root.tag.split("}")[0] + "}" if root.tag.startswith("{") else ""


def q(t):
    return f"{ns}{t}"


def local(tag):
    return tag.split("}")[-1] if "}" in tag else tag


for part in root.findall(f".//{q('part')}"):
    pid = part.get("id")
    clef_m1 = None
    m1 = part.find(q("measure"))
    if m1 is not None:
        for attr in m1.findall(q("attributes")):
            for c in attr.findall(q("clef")):
                if c.get("number", "1") == "1":
                    sign = c.find(q("sign"))
                    line = c.find(q("line"))
                    octch = c.find(q("clef-octave-change"))
                    clef_m1 = (
                        sign.text if sign is not None else "?",
                        line.text if line is not None else "?",
                        octch.text if octch is not None else "",
                    )
    rests = Counter()
    measure_rests = 0
    for note in part.iter():
        if local(note.tag) != "note":
            continue
        rest = note.find(q("rest"))
        if rest is None:
            continue
        step = rest.find(q("display-step"))
        octv = rest.find(q("display-octave"))
        typ = note.find(q("type"))
        tval = (typ.text or "").strip() if typ is not None else ""
        if rest.get("measure") == "yes":
            measure_rests += 1
        if step is not None and step.text:
            rests[(tval, step.text.strip(), (octv.text or "").strip(), rest.get("measure"))] += 1
    print(f"{pid} m1 clef={clef_m1} measure_rests={measure_rests}")
    for k, v in rests.most_common(8):
        print(f"  {k} x{v}")
