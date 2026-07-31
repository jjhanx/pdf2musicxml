import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from copy import deepcopy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import apply_fixes_to_root, rebuild_measure_timeline_clean, _local, _note_voice_staff

ZIP = Path(__file__).resolve().parents[1] / "omr-work-4b7162d2.zip"
NS = ""


def load(name: str) -> ET.Element:
    with zipfile.ZipFile(ZIP) as z:
        inner = zipfile.ZipFile(io.BytesIO(z.read(name)))
        return ET.fromstring(inner.read([n for n in inner.namelist() if n.endswith(".xml")][0]))


def dump_measure(part: ET.Element, mnum: str, label: str) -> None:
    m = next(x for x in part.findall("{*}measure") if x.get("number") == mnum)
    print(f"\n=== {label} m{mnum} ===")
    for child in m:
        loc = _local(child)
        if loc == "direction":
            st = child.find("{*}staff")
            print(f"  direction staff={st.text if st is not None else '?'}")
        elif loc == "backup":
            print(f"  backup dur={child.find('{*}duration').text}")
        elif loc == "note":
            v, st = _note_voice_staff(child, NS)
            rest = child.find("{*}rest") is not None
            pitch = child.find("{*}pitch")
            p = "rest" if rest else ""
            if pitch is not None:
                p = pitch.find("{*}step").text + pitch.find("{*}octave").text
            if child.find("{*}chord") is not None:
                p += "+chord"
            print(f"  note st={st} v={v} {p}")


raw = load("audiveris_raw.mxl")
part = raw.find('.//{*}part[@id="P5"]')

for label, after_idx, mxl in [
    ("before rebuild -1", -1, "8"),
    ("before rebuild 4", 4, "8"),
    ("before rebuild 3", 3, "8"),
]:
    r = deepcopy(raw)
    fix = {
        "kind": "insertDirection",
        "partId": "P5",
        "measureMxl": mxl,
        "afterNoteIndex": after_idx,
        "directionType": "dynamics",
        "directionValue": "p",
        "staff": 2,
    }
    apply_fixes_to_root(r, [fix])
    m = next(x for x in r.find('.//{*}part[@id="P5"]').findall("{*}measure") if x.get("number") == mxl)
    rebuild_measure_timeline_clean(m, NS)
    dump_measure(r.find('.//{*}part[@id="P5"]'), mxl, label + " after rebuild")

# also test m6 with -1
r = deepcopy(raw)
fix = {
    "kind": "insertDirection",
    "partId": "P5",
    "measureMxl": "6",
    "afterNoteIndex": -1,
    "directionType": "dynamics",
    "directionValue": "p",
    "staff": 2,
}
apply_fixes_to_root(r, [fix])
m = next(x for x in r.find('.//{*}part[@id="P5"]').findall("{*}measure") if x.get("number") == "6")
rebuild_measure_timeline_clean(m, NS)
dump_measure(r.find('.//{*}part[@id="P5"]'), "6", "m6 -1 after rebuild")

# check print offset
with zipfile.ZipFile(ZIP) as z:
    for n in z.namelist():
        if "measure" in n.lower() or "meta" in n.lower() or n.endswith(".json"):
            if n.endswith(".json"):
                import json
                data = json.loads(z.read(n))
                if isinstance(data, dict) and any("print" in str(k).lower() or "offset" in str(k).lower() for k in data):
                    print(n, data)
