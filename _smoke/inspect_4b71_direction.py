import io
import json
import sys
import zipfile
import xml.etree.ElementTree as ET
from copy import deepcopy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import (  # noqa: E402
    apply_fix,
    apply_fixes_to_root,
    list_note_elements,
    measure_snapshot,
    rebuild_measure_timeline_clean,
    _local,
    _note_voice_staff,
)

ZIP = Path(__file__).resolve().parents[1] / "omr-work-4b7162d2.zip"


def load(name: str) -> ET.Element:
    with zipfile.ZipFile(ZIP) as z:
        inner = zipfile.ZipFile(io.BytesIO(z.read(name)))
        return ET.fromstring(inner.read([n for n in inner.namelist() if n.endswith(".xml")][0]))


def dump_pl(part: ET.Element, mnum: str, label: str) -> None:
    m = next(x for x in part.findall("{*}measure") if x.get("number") == mnum)
    print(f"\n=== {label} MXL {mnum} ===")
    for child in m:
        loc = _local(child)
        if loc == "direction":
            st = child.find("{*}staff")
            p = child.find(".//{*}p") is not None
            print(f"  direction staff={st.text if st is not None else '?'} p={p}")
        elif loc == "backup":
            print(f"  backup dur={child.find('{*}duration').text}")
        elif loc == "note":
            v, st = _note_voice_staff(child, "")
            if st != "2":
                continue
            rest = child.find("{*}rest") is not None
            pitch = child.find("{*}pitch")
            p = "rest" if rest else ""
            if pitch is not None:
                p = pitch.find("{*}step").text + pitch.find("{*}octave").text
            typ = child.find("{*}type")
            print(
                f"  note v={v} {p} {typ.text if typ is not None else ''} "
                f"x={child.get('default-x', '')} chord={child.find('{*}chord') is not None}"
            )


def snap_pl(part_id: str, mnum: str, root: ET.Element) -> None:
    snap = measure_snapshot(root, "", part_id, mnum)
    pl = [e for e in snap["elements"] if e.get("staff") == 2 or e.get("elementKind") == "direction"]
    print(f"snapshot PL m{mnum}:")
    for e in pl:
        print(" ", e)


with zipfile.ZipFile(ZIP) as z:
    fixes = json.loads(z.read("omr_hitl_fixes.json"))
    fl = fixes.get("fixes", fixes)
    dirs = [f for f in fl if isinstance(f, dict) and "irection" in f.get("kind", "")]
    print("direction fixes in zip:", len(dirs))
    for f in dirs:
        print(json.dumps(f, ensure_ascii=False))

root = load("review.mxl")
part = root.find('.//{*}part[@id="P5"]')
for m in ("6", "7", "8", "9"):
    dump_pl(part, m, "review")
    snap_pl("P5", m, root)

# simulate wrong vs right insert on m8 (print 9 often m8)
raw = load("audiveris_raw.mxl")
part_raw = raw.find('.//{*}part[@id="P5"]')

for label, after_idx, mxl in [
    ("WRONG madi ap", -1, "8"),
    ("WRONG #0", 0, "8"),
    ("REST #4", 4, "8"),
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
    print(f"\n--- after insert {label} ---")
    dump_pl(r.find('.//{*}part[@id="P5"]'), mxl, label)
