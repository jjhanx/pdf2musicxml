"""Export m17 with play orders: #5→2, #3→2, #4→3, #7→4."""
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
        {"kind": "setPlayOrder", "partId": "P5", "measureMxl": "17", "noteIndex": 5, "playOrder": 2, "staff": 1},
        {"kind": "setPlayOrder", "partId": "P5", "measureMxl": "17", "noteIndex": 3, "playOrder": 2, "staff": 1},
        {"kind": "setPlayOrder", "partId": "P5", "measureMxl": "17", "noteIndex": 4, "playOrder": 3, "staff": 1},
        {"kind": "setPlayOrder", "partId": "P5", "measureMxl": "17", "noteIndex": 7, "playOrder": 4, "staff": 1},
    ],
)
sys.stdout.write(ET.tostring(root, encoding="unicode"))
