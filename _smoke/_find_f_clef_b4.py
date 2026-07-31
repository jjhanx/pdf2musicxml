import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(r"D:/pdf2musicxml/_smoke")


def analyze(mxl: Path):
    with zipfile.ZipFile(mxl) as z:
        root = ET.fromstring(z.read([n for n in z.namelist() if n.endswith(".xml") and "META" not in n][0]))
    ns = root.tag.split("}")[0] + "}" if root.tag.startswith("{") else ""

    def q(t):
        return f"{ns}{t}"

    hits = []
    for part in root.findall(f".//{q('part')}"):
        pid = part.get("id")
        m1 = part.find(q("measure"))
        clef = "?"
        if m1 is not None:
            for attr in m1.findall(q("attributes")):
                for c in attr.findall(q("clef")):
                    if c.get("number", "1") == "1":
                        sign = c.find(q("sign"))
                        clef = sign.text if sign is not None else "?"
        if clef != "F":
            continue
        b4 = 0
        for note in part.iter():
            if note.tag.split("}")[-1] != "note":
                continue
            rest = note.find(q("rest"))
            if rest is None:
                continue
            step = rest.find(q("display-step"))
            octv = rest.find(q("display-octave"))
            if step is not None and step.text == "B" and octv is not None and octv.text == "4":
                b4 += 1
        if b4:
            hits.append((pid, b4))
    if hits:
        print(mxl.parent.name, hits)


for mxl in sorted(ROOT.glob("omr-work*/review.mxl")):
    try:
        analyze(mxl)
    except Exception:
        pass
