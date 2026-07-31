import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

mxl = Path(r"D:/pdf2musicxml/_smoke/omr-work-1b1b34df-full/review.mxl")
with zipfile.ZipFile(mxl) as z:
    root = ET.fromstring(z.read([n for n in z.namelist() if n.endswith(".xml") and "META" not in n][0]))
ns = root.tag.split("}")[0] + "}" if root.tag.startswith("{") else ""


def q(t):
    return f"{ns}{t}"


def dump_part_rests_m10(pid):
    part = root.find(f'.//{q("part")}[@id="{pid}"]')
    m10 = next(x for x in part.findall(q("measure")) if x.get("number") == "10")
    print(f"\n{pid} m10:")
    for note in m10.findall(q("note")):
        rest = note.find(q("rest"))
        if rest is None:
            continue
        typ = note.find(q("type"))
        step = rest.find(q("display-step"))
        octv = rest.find(q("display-octave"))
        print(
            " ",
            (typ.text or "").strip() if typ is not None else "",
            "step",
            step.text if step is not None else None,
            "oct",
            octv.text if octv is not None else None,
            "default-y",
            note.get("default-y"),
            "measure",
            rest.get("measure"),
        )


for pid in ["P1", "P2", "P3"]:
    dump_part_rests_m10(pid)
