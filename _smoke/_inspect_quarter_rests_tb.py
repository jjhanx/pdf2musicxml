import zipfile
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

mxl = Path(r"D:/pdf2musicxml/_smoke/omr-work-1b1b34df-full/review.mxl")
with zipfile.ZipFile(mxl) as z:
    root = ET.fromstring(z.read([n for n in z.namelist() if n.endswith(".xml") and "META" not in n][0]))
ns = root.tag.split("}")[0] + "}" if root.tag.startswith("{") else ""


def q(t):
    return f"{ns}{t}"


labels = ["T", "S", "B", "P"]
for i, part in enumerate(root.findall(f".//{q('part')}")):
    pid = part.get("id")
    label = labels[i] if i < len(labels) else pid
    clef = "G"
    m1 = part.find(q("measure"))
    if m1 is not None:
        for attr in m1.findall(q("attributes")):
            for c in attr.findall(q("clef")):
                if c.get("number", "1") == "1":
                    sign = c.find(q("sign"))
                    clef = sign.text if sign is not None else "?"
    by_type = Counter()
    for note in part.iter():
        if note.tag.split("}")[-1] != "note":
            continue
        rest = note.find(q("rest"))
        if rest is None:
            continue
        typ = note.find(q("type"))
        tval = (typ.text or "").strip() if typ is not None and typ.text else ""
        step = rest.find(q("display-step"))
        octv = rest.find(q("display-octave"))
        s = (step.text or "").strip() if step is not None else ""
        o = (octv.text or "").strip() if octv is not None else ""
        if s:
            by_type[(tval or "measure", s, o)] += 1
    print(f"\n{label} ({pid}) m1 clef={clef}")
    for k, v in by_type.most_common(8):
        print(f"  {k} x{v}")
