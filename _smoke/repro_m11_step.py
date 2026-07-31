import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from copy import deepcopy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import apply_fix, rebuild_measure_timeline_clean, _local, _note_staff_number, _measure_has_multivoice_layers, _ns

ZIP = Path(__file__).resolve().parents[1] / "omr-work-4b7162d2.zip"


def load(name: str) -> ET.Element:
    with zipfile.ZipFile(ZIP) as z:
        inner = zipfile.ZipFile(io.BytesIO(z.read(name)))
        return ET.fromstring(inner.read([n for n in inner.namelist() if n.endswith(".xml")][0]))


def show_dirs(m):
    for i, c in enumerate(m):
        loc = _local(c)
        if loc == "direction":
            st = c.find("{*}staff")
            print(f"  [{i}] direction staff={st.text if st is not None else '?'}")
        elif loc == "backup":
            print(f"  [{i}] backup")
        elif loc == "note":
            st = _note_staff_number(c, "")
            print(f"  [{i}] note staff={st}")


raw = load("audiveris_raw.mxl")
m0 = next(x for x in raw.find('.//{*}part[@id="P5"]').findall("{*}measure") if x.get("number") == "11")
print("multivoice", _measure_has_multivoice_layers(m0, _ns(raw)))

part = raw.find('.//{*}part[@id="P5"]')
m = next(x for x in part.findall("{*}measure") if x.get("number") == "11")

r = deepcopy(raw)
apply_fix(
    r,
    "",
    {
        "kind": "insertDirection",
        "partId": "P5",
        "measureMxl": "11",
        "afterNoteIndex": -1,
        "directionType": "dynamics",
        "directionValue": "mf",
        "staff": 1,
    },
)
m1 = next(x for x in r.find('.//{*}part[@id="P5"]').findall("{*}measure") if x.get("number") == "11")
print("After PR insert (no rebuild):")
show_dirs(m1)

apply_fix(
    r,
    "",
    {
        "kind": "insertDirection",
        "partId": "P5",
        "measureMxl": "11",
        "afterNoteIndex": -1,
        "directionType": "dynamics",
        "directionValue": "mf",
        "staff": 2,
    },
)
m2 = next(x for x in r.find('.//{*}part[@id="P5"]').findall("{*}measure") if x.get("number") == "11")
print("\nAfter PL insert (no rebuild):")
show_dirs(m2)

rebuild_measure_timeline_clean(m2, "")
print("\nAfter rebuild:")
show_dirs(m2)

# count directions
dirs = m2.findall("direction") + m2.findall("{*}direction")
print(f"\ndirection count: {len([c for c in m2 if _local(c)=='direction'])}")
