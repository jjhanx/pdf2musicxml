import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import measure_snapshot, _local

ZIP = Path(__file__).resolve().parents[1] / "omr-work-29eb585d.zip"


def load(name: str) -> ET.Element:
    with zipfile.ZipFile(ZIP) as z:
        inner = zipfile.ZipFile(io.BytesIO(z.read(name)))
        return ET.fromstring(inner.read([n for n in inner.namelist() if n.endswith(".xml")][0]))


root = load("review.mxl")
for m in ("12", "13"):
    snap = measure_snapshot(root, "", "P3", m)
    print(f"\n=== P3 m{m} ===")
    for e in snap["elements"]:
        if e.get("elementKind") != "note":
            continue
        tie = ""
        if e.get("tieStart"):
            tie += " tie→"
        if e.get("tieStop"):
            tie += " tie←"
        if e.get("chord"):
            continue
        print(
            f"  #{e['index']} {e.get('pitch')} staff={e.get('staff')} type={e.get('type')}{tie}"
        )
