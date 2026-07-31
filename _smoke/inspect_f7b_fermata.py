import io
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ZIP = Path(__file__).resolve().parents[1] / "omr-work-f7b18c9d.zip"


def dump(name: str) -> None:
    with zipfile.ZipFile(ZIP) as z:
        inner = zipfile.ZipFile(io.BytesIO(z.read(name)))
        root = ET.fromstring(inner.read([n for n in inner.namelist() if n.endswith(".xml")][0]))
    part = root.find('.//{*}part[@id="P5"]')
    m = next(x for x in part.findall("{*}measure") if x.get("number") == "7")
    print(f"=== {name} m7 PL ===")
    ni = 0
    for c in m:
        if c.tag.rsplit("}", 1)[-1] != "note":
            continue
        st = c.find("{*}staff")
        if (st.text if st is not None else "1") != "2":
            ni += 1
            continue
        ferm = c.find(".//{*}fermata")
        pitch = c.find("{*}pitch")
        p = ""
        if pitch is not None:
            p = pitch.find("{*}step").text + pitch.find("{*}octave").text
        typ = c.find("{*}type")
        notations = c.find("{*}notations")
        ntxt = ET.tostring(notations, encoding="unicode") if notations is not None else ""
        print(f"#{ni} {p} {typ.text if typ is not None else ''} fermata={ferm is not None} {ntxt[:100]}")
        ni += 1


dump("review.mxl")
dump("audiveris_raw.mxl")
