import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

mxl = Path(r"D:/pdf2musicxml/_smoke/omr-work-1b1b34df-full/review.mxl")
with zipfile.ZipFile(mxl) as z:
    root = ET.fromstring(z.read([n for n in z.namelist() if n.endswith(".xml") and "META" not in n][0]))
ns = root.tag.split("}")[0] + "}" if root.tag.startswith("{") else ""


def q(t):
    return f"{ns}{t}"


def first_quarter_rest(part):
    for m in part.findall(q("measure")):
        for note in m.findall(q("note")):
            rest = note.find(q("rest"))
            typ = note.find(q("type"))
            if rest is None:
                continue
            if (typ.text or "").strip() == "quarter":
                step = rest.find(q("display-step"))
                octv = rest.find(q("display-octave"))
                return m.get("number"), {
                    "step": step.text if step is not None else None,
                    "oct": octv.text if octv is not None else None,
                    "dy": note.get("default-y"),
                }
    return None, None


for pid in ["P1", "P2", "P3"]:
    part = root.find(f'.//{q("part")}[@id="{pid}"]')
    mn, info = first_quarter_rest(part)
    print(pid, "first quarter rest m", mn, info)

# clef at m33
for pid in ["P1", "P3"]:
    part = root.find(f'.//{q("part")}[@id="{pid}"]')
    m33 = next(x for x in part.findall(q("measure")) if x.get("number") == "33")
    for note in m33.findall(q("note")):
        rest = note.find(q("rest"))
        if rest is None:
            continue
        typ = note.find(q("type"))
        step = rest.find(q("display-step"))
        octv = rest.find(q("display-octave"))
        print(
            pid,
            "m33 rest",
            (typ.text or "").strip() if typ is not None else "",
            step.text if step is not None else None,
            octv.text if octv is not None else None,
        )
