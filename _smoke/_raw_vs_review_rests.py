import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

for name in ["audiveris_raw.mxl", "review.mxl"]:
    mxl = Path(r"D:/pdf2musicxml/_smoke/omr-work-1b1b34df-full") / name
    with zipfile.ZipFile(mxl) as z:
        root = ET.fromstring(z.read([n for n in z.namelist() if n.endswith(".xml") and "META" not in n][0]))
    ns = root.tag.split("}")[0] + "}" if root.tag.startswith("{") else ""

    def q(t):
        return f"{ns}{t}"

    print("\n", name)
    for pid in ["P1", "P3"]:
        part = root.find(f'.//{q("part")}[@id="{pid}"]')
        n = 0
        for note in part.iter():
            if note.tag.split("}")[-1] != "note":
                continue
            rest = note.find(q("rest"))
            if rest is None:
                continue
            step = rest.find(q("display-step"))
            if step is not None and step.text:
                n += 1
        print(pid, "rests with display-step", n)
