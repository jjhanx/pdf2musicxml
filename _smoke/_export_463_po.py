import io, sys, zipfile, xml.etree.ElementTree as ET
from pathlib import Path
sys.path.insert(0, "scripts")
import omr_hitl_lib as lib

z = zipfile.ZipFile("omr-work-4637986c.zip")
data = z.read("review.mxl")
inner = zipfile.ZipFile(io.BytesIO(data))
xml = inner.read([n for n in inner.namelist() if n.endswith(".xml") and "META" not in n.upper()][0])
root = ET.fromstring(xml)
# sanitize + set correct POs like user
lib.apply_fixes_to_root(root, [
    {"kind": "setPlayOrder", "partId": "P5", "measureMxl": "17", "noteIndex": 0, "playOrder": 1, "staff": 1},
    {"kind": "setPlayOrder", "partId": "P5", "measureMxl": "17", "noteIndex": 5, "playOrder": 2, "staff": 1},
    {"kind": "setPlayOrder", "partId": "P5", "measureMxl": "17", "noteIndex": 3, "playOrder": 2, "staff": 1},
    {"kind": "setPlayOrder", "partId": "P5", "measureMxl": "17", "noteIndex": 4, "playOrder": 3, "staff": 1},
    {"kind": "setPlayOrder", "partId": "P5", "measureMxl": "17", "noteIndex": 7, "playOrder": 4, "staff": 1},
])
Path("_smoke/_tmp_463_po_fixed.xml").write_text(ET.tostring(root, encoding="unicode"), encoding="utf-8")
print("wrote")
