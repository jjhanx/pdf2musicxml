"""Apply setPlayOrder 1/2/3 to m17 F4, E5, F5 on P5 (quarter → parallel → beamed eighth)."""
import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import omr_hitl_lib as lib

ZIP = ROOT / "omr-work-0ea5ea52.zip"
with zipfile.ZipFile(ZIP) as z:
    data = z.read("review.mxl")
with zipfile.ZipFile(io.BytesIO(data)) as inner:
    xml = inner.read(
        [n for n in inner.namelist() if n.endswith(".xml") and "META" not in n.upper()][0]
    )
root = ET.fromstring(xml)
lib.apply_fixes_to_root(
    root,
    [
        {"kind": "setPlayOrder", "partId": "P5", "measureMxl": "17", "noteIndex": 3, "playOrder": 2, "staff": 1},
        {"kind": "setPlayOrder", "partId": "P5", "measureMxl": "17", "noteIndex": 4, "playOrder": 3, "staff": 1},
        # F4 동일 pitch 전체에 적용되므로 마지막에 po=1 (앞 fix가 F4에 po=3 덮어쓰지 않게)
        {"kind": "setPlayOrder", "partId": "P5", "measureMxl": "17", "noteIndex": 0, "playOrder": 1, "staff": 1},
    ],
)
sys.stdout.write(ET.tostring(root, encoding="unicode"))
