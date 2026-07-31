import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import apply_fixes_to_root

def local_tag(el):
    t = el.tag
    return t.rsplit("}", 1)[-1] if "}" in t else t

z = zipfile.ZipFile("omr-work-20e53bc4.zip")
inner = zipfile.ZipFile(io.BytesIO(z.read("review.mxl")))
root = ET.fromstring(inner.read([n for n in inner.namelist() if n.endswith(".xml")][0]))

apply_fixes_to_root(
    root,
    [
        {
            "kind": "setNoteDirection",
            "partId": "P5",
            "measureMxl": "17",
            "noteIndex": 24,
            "staff": 2,
            "directionType": "words",
            "directionValue": "PL TEST",
        }
    ],
)

for pid in ("P1", "P2", "P5"):
    part = root.find(f'.//{{*}}part[@id="{pid}"]')
    if part is None:
        continue
    m = next(x for x in part.findall("{*}measure") if x.get("number") == "17")
    print(f"=== {pid} m17 ===")
    for i, c in enumerate(m):
        loc = local_tag(c)
        if loc == "direction":
            st = c.find("{*}staff")
            w = c.find(".//{*}words")
            v = c.find("{*}voice")
            print(
                i,
                "direction",
                "staff",
                st.text if st is not None else "-",
                "voice",
                v.text if v is not None else "-",
                "words",
                w.text if w is not None else "",
            )
        elif loc == "note" and c.find("{*}staff") is not None and i < 5:
            print(i, "note", "staff", c.find("{*}staff").text)
