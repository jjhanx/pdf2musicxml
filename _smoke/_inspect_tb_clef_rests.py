import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

mxl = Path(r"D:\pdf2musicxml\_smoke\_6cbf_final\review.mxl")
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
    clef_changes = []
    for m in part.findall(q("measure")):
        mn = m.get("number")
        for attr in m.findall(q("attributes")):
            for c in attr.findall(q("clef")):
                sign = c.find(q("sign"))
                line = c.find(q("line"))
                octch = c.find(q("clef-octave-change"))
                sn = sign.text if sign is not None else "?"
                ln = line.text if line is not None else "?"
                oc = octch.text if octch is not None else ""
                clef_changes.append((mn, sn, ln, oc, c.get("number", "1")))
    if clef_changes:
        print(f"{pid} clefs: {clef_changes[:8]}{'...' if len(clef_changes)>8 else ''}")

    # sample quarter rest in m5
    m5 = next((x for x in part.findall(q("measure")) if x.get("number") == "5"), None)
    if m5 is not None:
        for note in m5.findall(q("note")):
            rest = note.find(q("rest"))
            if rest is None:
                continue
            typ = note.find(q("type"))
            tval = (typ.text or "").strip() if typ is not None else ""
            if tval != "quarter":
                continue
            step = rest.find(q("display-step"))
            octv = rest.find(q("display-octave"))
            print(
                f"  {pid} m5 quarter rest: step={step.text if step is not None else None} "
                f"oct={octv.text if octv is not None else None}"
            )
            break
