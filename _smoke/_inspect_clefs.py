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
    return tag.split("}")[-1]


for part in root.findall(f".//{q('part')}"):
    pid = part.get("id")
    for m in part.findall(q("measure"))[:5]:
        mn = m.get("number")
        for attr in m.findall(q("attributes")):
            clefs = attr.findall(q("clef"))
            if clefs:
                for c in clefs:
                    sign = c.find(q("sign"))
                    line = c.find(q("line"))
                    octch = c.find(q("clef-octave-change"))
                    sn = sign.text if sign is not None else "?"
                    ln = line.text if line is not None else "?"
                    oc = octch.text if octch is not None else ""
                    print(f"{pid} m{mn} clef staff={c.get('number', '1')} {sn} line {ln} oct {oc}")
