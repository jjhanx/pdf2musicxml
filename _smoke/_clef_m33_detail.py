import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

mxl = Path(r"D:/pdf2musicxml/_smoke/omr-work-1b1b34df-full/review.mxl")
with zipfile.ZipFile(mxl) as z:
    root = ET.fromstring(z.read([n for n in z.namelist() if n.endswith(".xml") and "META" not in n][0]))
ns = root.tag.split("}")[0] + "}" if root.tag.startswith("{") else ""


def q(t):
    return f"{ns}{t}"


part = root.find(f'.//{q("part")}[@id="P1"]')
cur = "G"
for m in part.findall(q("measure")):
    mn = int(m.get("number"))
    if mn < 32 or mn > 36:
        continue
    for attr in m.findall(q("attributes")):
        for c in attr.findall(q("clef")):
            if c.get("number", "1") == "1":
                sign = c.find(q("sign"))
                if sign is not None and sign.text:
                    cur = sign.text
                    print(f"m{mn} clef change -> {cur}")
    rests = []
    for note in m.findall(q("note")):
        rest = note.find(q("rest"))
        if rest is None:
            continue
        typ = note.find(q("type"))
        step = rest.find(q("display-step"))
        octv = rest.find(q("display-octave"))
        rests.append(
            (
                (typ.text or "").strip() if typ is not None else "",
                step.text if step is not None else None,
                octv.text if octv is not None else None,
            )
        )
    if rests:
        print(f"m{mn} active clef={cur} rests={rests[:4]}")
