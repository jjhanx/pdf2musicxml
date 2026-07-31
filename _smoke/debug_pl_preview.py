import io
import json
import zipfile
import xml.etree.ElementTree as ET
from copy import deepcopy
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import (
    apply_fixes_to_root,
    _local,
    _measure_has_multivoice_layers,
    _ns,
)

ZIP = Path(__file__).resolve().parents[1] / "omr-work-20e53bc4.zip"


def load():
    with zipfile.ZipFile(ZIP) as z:
        inner = zipfile.ZipFile(io.BytesIO(z.read("review.mxl")))
        return ET.fromstring(inner.read([n for n in inner.namelist() if n.endswith(".xml")][0]))


def dump_dirs(root, measure_num="17"):
    for pid in ("P1", "P2", "P3", "P4", "P5"):
        part = root.find(f'.//{{*}}part[@id="{pid}"]')
        if part is None:
            continue
        m = next((x for x in part.findall("{*}measure") if x.get("number") == measure_num), None)
        if m is None:
            continue
        dirs = []
        for i, c in enumerate(m):
            if _local(c) == "direction":
                st = c.find("{*}staff")
                w = c.find(".//{*}words")
                dirs.append((i, st.text if st is not None else None, w.text if w is not None else None))
        if dirs:
            print(f"  {pid} m{measure_num}: {dirs}")


root = load()
ns = _ns(root)
m = next(x for x in root.find('.//{*}part[@id="P5"]').findall("{*}measure") if x.get("number") == "17")
print("P5 m17 multivoice:", _measure_has_multivoice_layers(m, ns))
voices = set()
for n in m.findall("{*}note"):
    v = n.find("{*}voice")
    s = n.find("{*}staff")
    if v is not None:
        voices.add((v.text, s.text if s is not None else "?"))
print("voice/staff pairs:", sorted(voices))

r = deepcopy(root)
apply_fixes_to_root(
    r,
    [
        {
            "kind": "insertDirection",
            "partId": "P5",
            "measureMxl": "17",
            "afterNoteIndex": -1,
            "directionType": "words",
            "directionValue": "poco piu mosso",
            "staff": 2,
        }
    ],
)
m2 = next(x for x in r.find('.//{*}part[@id="P5"]').findall("{*}measure") if x.get("number") == "17")
print("\nAfter insert + rebuild:")
print("multivoice:", _measure_has_multivoice_layers(m2, ns))
for i, c in enumerate(m2):
    loc = _local(c)
    if loc in ("direction", "backup"):
        st = c.find("{*}staff")
        w = c.find(".//{*}words")
        print(f"  {i} {loc} staff={st.text if st is not None else '-'} text={w.text if w is not None else ''}")
    elif loc == "note" and c.find("{*}staff") is not None and c.find("{*}staff").text == "2" and i < 30:
        if i <= 27:
            print(f"  {i} note staff=2")

print("\nAll directions m17:")
dump_dirs(r, "17")
print("\nAll directions m18:")
dump_dirs(r, "18")
