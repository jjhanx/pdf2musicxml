"""Extract P5 m27 from omr-work-3c30ccde review.mxl as minimal score XML."""
from __future__ import annotations

import io
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ZIP = Path(r"D:/pdf2musicxml/omr-work-3c30ccde.zip")
OUT = Path(r"D:/pdf2musicxml/_smoke/_3c30_m27_p5.xml")


def L(tag: str) -> str:
    return tag.split("}")[-1]


def main() -> None:
    with zipfile.ZipFile(ZIP) as z:
        data = z.read("review.mxl")
    with zipfile.ZipFile(io.BytesIO(data)) as mz:
        name = next(n for n in mz.namelist() if n.endswith(".xml") and "META" not in n.upper())
        root = ET.fromstring(mz.read(name))
    part = next(p for p in root if L(p.tag) == "part" and p.get("id") == "P5")
    m = next(c for c in part if L(c.tag) == "measure" and c.get("number") == "27")
    score = ET.Element("score-partwise", version="3.1")
    pl = ET.SubElement(score, "part-list")
    sp = ET.SubElement(pl, "score-part", id="P5")
    ET.SubElement(sp, "part-name").text = "P"
    p2 = ET.SubElement(score, "part", id="P5")
    p2.append(m)
    OUT.write_text(ET.tostring(score, encoding="unicode"), encoding="utf-8")
    print("wrote", OUT, "bytes", OUT.stat().st_size)


if __name__ == "__main__":
    main()
