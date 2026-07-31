import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from copy import deepcopy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import (
    apply_fixes_to_root,
    measure_snapshot,
    _local,
    _note_voice_staff,
)

ZIP = Path(__file__).resolve().parents[1] / "omr-work-4b7162d2.zip"
NS = ""


def load(name: str) -> ET.Element:
    with zipfile.ZipFile(ZIP) as z:
        inner = zipfile.ZipFile(io.BytesIO(z.read(name)))
        return ET.fromstring(inner.read([n for n in inner.namelist() if n.endswith(".xml")][0]))


def dump_m11(root: ET.Element, label: str) -> None:
    part = root.find('.//{*}part[@id="P5"]')
    m = next(x for x in part.findall("{*}measure") if x.get("number") == "11")
    print(f"\n=== {label} ===")
    for c in m:
        loc = _local(c)
        if loc == "direction":
            st = c.find("{*}staff")
            mf = c.find(".//{*}mf") is not None
            pl = c.get("placement", "")
            print(f"  direction staff={st.text if st is not None else '?'} mf={mf} placement={pl}")
        elif loc == "backup":
            print(f"  backup dur={c.find('{*}duration').text}")
        elif loc == "note":
            v, st = _note_voice_staff(c, NS)
            rest = c.find("{*}rest") is not None
            pitch = c.find("{*}pitch")
            p = "rest" if rest else ""
            if pitch is not None:
                p = pitch.find("{*}step").text + pitch.find("{*}octave").text
                if c.find("{*}chord") is not None:
                    p += "+ch"
            print(f"  note st={st} v={v} {p} x={c.get('default-x','')[:6]}")


raw = load("audiveris_raw.mxl")
dump_m11(raw, "raw m11")
snap = measure_snapshot(raw, NS, "P5", "11")
print("\nsnapshot elements (staff dirs):")
for e in snap["elements"]:
    if e.get("elementKind") == "direction" or (e.get("staff") in (1, 2) and e.get("index", 0) < 5):
        print(" ", e)

# simulate PR then PL mf at measure start
for label, fixes in [
    ("PR only", [{"staff": 1, "afterNoteIndex": -1}]),
    ("PR then PL", [{"staff": 1, "afterNoteIndex": -1}, {"staff": 2, "afterNoteIndex": -1}]),
    ("PL then PR", [{"staff": 2, "afterNoteIndex": -1}, {"staff": 1, "afterNoteIndex": -1}]),
]:
    r = deepcopy(raw)
    fl = []
    for i, f in enumerate(fixes):
        fl.append(
            {
                "kind": "insertDirection",
                "partId": "P5",
                "measureMxl": "11",
                "directionType": "dynamics",
                "directionValue": "mf",
                **f,
            }
        )
    stats = apply_fixes_to_root(r, fl)
    print(f"\n{label} applied={stats}")
    dump_m11(r, label)
