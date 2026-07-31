"""Trace PL direction through preview pipeline: raw -> apply -> split simulation."""
import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import apply_fixes_to_root, _local, _migrate_directions_to_notes, _ns

ZIP = Path(__file__).resolve().parents[1] / "omr-work-20e53bc4.zip"


def load_root():
    with zipfile.ZipFile(ZIP) as z:
        inner = zipfile.ZipFile(io.BytesIO(z.read("review.mxl")))
        return ET.fromstring(inner.read([n for n in inner.namelist() if n.endswith(".xml")][0]))


def dump_measure(part_id, measure, limit=30):
    print(f"\n=== {part_id} m{measure.get('number')} ===")
    for i, c in enumerate(list(measure)[:limit]):
        tag = _local(c)
        if tag == "direction":
            st = c.find("{*}staff")
            v = c.find("{*}voice")
            w = c.find(".//{*}words")
            print(
                f"  {i:2} direction staff={st.text if st is not None else '-'} "
                f"voice={v.text if v is not None else '-'} {w.text if w is not None else ''!r}"
            )
        elif tag == "note":
            st = c.find("{*}staff")
            v = c.find("{*}voice")
            dx = c.get("default-x")
            print(f"  {i:2} note staff={st.text if st is not None else '-'} voice={v.text if v is not None else '-'} dx={dx}")
        elif tag in ("backup", "forward"):
            d = c.find("{*}duration")
            print(f"  {i:2} {tag} dur={d.text if d is not None else '?'}")


root = load_root()
apply_fixes_to_root(
    root,
    [
        {
            "kind": "setNoteDirection",
            "partId": "P5",
            "measureMxl": "17",
            "noteIndex": 24,
            "directionType": "words",
            "directionValue": "PL TEST",
        }
    ],
)

for pid in ["P1", "P5"]:
    part = next(p for p in root.findall(".//{*}part") if p.get("id") == pid)
    m = next(x for x in part.findall("{*}measure") if x.get("number") == "17")
    dump_measure(pid, m, 35)

# P5: show direction index vs first PL note
p5 = next(p for p in root.findall(".//{*}part") if p.get("id") == "P5")
m5 = next(x for x in p5.findall("{*}measure") if x.get("number") == "17")
children = list(m5)
dir_i = next(i for i, c in enumerate(children) if _local(c) == "direction" and c.find(".//{*}words") is not None)
pl_i = next(
    i
    for i, c in enumerate(children)
    if _local(c) == "note" and c.find("{*}staff") is not None and c.find("{*}staff").text == "2"
)
print(f"\nP5 PL direction index={dir_i}, first PL note index={pl_i}, adjacency={dir_i + 1 == pl_i}")

# first PL note default-x
pl_note = children[pl_i]
print(f"PL note default-x={pl_note.get('default-x')}")

# any direction at measure start in P5?
start_dirs = [i for i, c in enumerate(children[:5]) if _local(c) == "direction"]
print(f"directions in first 5 elements of P5 m17: {start_dirs}")
