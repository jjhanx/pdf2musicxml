import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from copy import deepcopy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import apply_fixes_to_root, rebuild_measure_timeline_clean, _local, _note_voice_staff

ZIP = Path(__file__).resolve().parents[1] / "omr-work-4b7162d2.zip"


def load(name: str) -> ET.Element:
    with zipfile.ZipFile(ZIP) as z:
        inner = zipfile.ZipFile(io.BytesIO(z.read(name)))
        return ET.fromstring(inner.read([n for n in inner.namelist() if n.endswith(".xml")][0]))


def pl_dyn_p(part: ET.Element, mnum: str) -> None:
    m = next(x for x in part.findall("{*}measure") if x.get("number") == mnum)
    print(f"m{mnum} PL timeline:")
    for c in m:
        loc = _local(c)
        if loc == "direction":
            st = c.find("{*}staff")
            if st is not None and st.text == "2":
                print("  dyn:p")
        elif loc == "note":
            _, st = _note_voice_staff(c, "")
            if st != "2":
                continue
            rest = c.find("{*}rest") is not None
            print(f"  {'rest' if rest else 'note'}")


raw = load("audiveris_raw.mxl")
for label, fix in [
    ("OLD default -1", {"afterNoteIndex": -1}),
    ("REST #4 dyn", {"afterNoteIndex": 4}),
    ("REST quick p", {"afterNoteIndex": 4}),
]:
    r = deepcopy(raw)
    apply_fixes_to_root(
        r,
        [
            {
                "kind": "insertDirection",
                "partId": "P5",
                "measureMxl": "8",
                "directionType": "dynamics",
                "directionValue": "p",
                "staff": 2,
                **fix,
            }
        ],
    )
    print(f"\n=== {label} ===")
    pl_dyn_p(r.find('.//{*}part[@id="P5"]'), "8")
