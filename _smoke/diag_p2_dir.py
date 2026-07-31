"""Diagnose PL direction vs P2 in omr-work zip after setNoteDirection."""
import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import apply_fixes_to_root, _local

ZIP = Path(__file__).resolve().parents[1] / "omr-work-20e53bc4.zip"


def load_root():
    with zipfile.ZipFile(ZIP) as z:
        inner = zipfile.ZipFile(io.BytesIO(z.read("review.mxl")))
        return ET.fromstring(inner.read([n for n in inner.namelist() if n.endswith(".xml")][0]))


def dump_part_measure(root, part_id, mxl):
    part = next(p for p in root.findall(".//{*}part") if p.get("id") == part_id)
    measure = next(m for m in part.findall("{*}measure") if m.get("number") == str(mxl))
    print(f"\n=== {part_id} m{mxl} ===")
    for i, c in enumerate(measure):
        tag = _local(c)
        if tag == "direction":
            st = c.find("{*}staff")
            v = c.find("{*}voice")
            w = c.find(".//{*}words")
            dyn = c.find(".//{*}dynamics")
            txt = (w.text if w is not None else "") or ("dyn:" + _local(dyn[0]) if dyn is not None and len(dyn) else "")
            print(f"  {i:2} direction staff={st.text if st is not None else '-'} voice={v.text if v is not None else '-'} {txt!r}")
        elif tag == "note":
            st = c.find("{*}staff")
            v = c.find("{*}voice")
            rest = c.find("{*}rest") is not None
            pitch = c.find(".//{*}step")
            p = f"{pitch.text}{c.find('.//{*}octave').text}" if pitch is not None else ("rest" if rest else "?")
            nd = c.find(".//{*}dynamics")
            print(f"  {i:2} note staff={st.text if st is not None else '-'} voice={v.text if v is not None else '-'} {p} dyn={nd is not None}")


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
for pid in ["P1", "P2", "P3", "P4", "P5"]:
    try:
        dump_part_measure(root, pid, 17)
    except StopIteration:
        pass

# any direction with staff=2 anywhere?
print("\n=== directions with <staff>2 in entire score ===")
for d in root.iter():
    if _local(d) != "direction":
        continue
    st = d.find("{*}staff")
    if st is not None and (st.text or "").strip() == "2":
        parent_part = None
        for p in root.findall(".//{*}part"):
            if d in list(p.iter()):
                parent_part = p.get("id")
                break
        print(" part", parent_part, "staff=2 on direction")
