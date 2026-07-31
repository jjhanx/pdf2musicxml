import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

ROOT = Path(r"D:\pdf2musicxml\_smoke")


def load_root(mxl: Path):
    with zipfile.ZipFile(mxl) as z:
        xml_name = [n for n in z.namelist() if n.endswith(".xml") and "META" not in n][0]
        return ET.fromstring(z.read(xml_name))


def analyze(mxl: Path):
    root = load_root(mxl)
    ns = root.tag.split("}")[0] + "}" if root.tag.startswith("{") else ""

    def q(t):
        return f"{ns}{t}"

    def local(tag):
        return tag.split("}")[-1] if "}" in tag else tag

    print(f"\n=== {mxl.parent.name} ===")
    for part in root.findall(f".//{q('part')}"):
        pid = part.get("id")
        clef_m1 = None
        m1 = part.find(q("measure"))
        if m1 is not None:
            for attr in m1.findall(q("attributes")):
                for c in attr.findall(q("clef")):
                    if c.get("number", "1") == "1":
                        sign = c.find(q("sign"))
                        clef_m1 = sign.text if sign is not None else "?"
        rests = Counter()
        for note in part.iter():
            if local(note.tag) != "note":
                continue
            rest = note.find(q("rest"))
            if rest is None:
                continue
            step = rest.find(q("display-step"))
            octv = rest.find(q("display-octave"))
            if step is not None and step.text:
                typ = note.find(q("type"))
                tval = (typ.text or "").strip() if typ is not None else ""
                rests[(tval, step.text.strip(), (octv.text or "").strip(), rest.get("measure"))] += 1
        if clef_m1 == "F" or any(k[1] == "B" and k[2] == "4" for k in rests):
            print(f"  {pid} m1 clef={clef_m1} rests={dict(rests.most_common(4))}")


for mxl in sorted(ROOT.glob("omr-work*/review.mxl"))[:8]:
    try:
        analyze(mxl)
    except Exception as e:
        print(mxl, e)
