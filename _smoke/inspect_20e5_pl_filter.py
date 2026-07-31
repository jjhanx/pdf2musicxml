import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from copy import deepcopy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import apply_fixes_to_root, _local

ZIP = Path(__file__).resolve().parents[1] / "omr-work-20e53bc4.zip"


def load() -> ET.Element:
    with zipfile.ZipFile(ZIP) as z:
        inner = zipfile.ZipFile(io.BytesIO(z.read("review.mxl")))
        return ET.fromstring(inner.read([n for n in inner.namelist() if n.endswith(".xml")][0]))


def order_label(m: ET.Element) -> list[str]:
    out = []
    for c in m:
        loc = _local(c)
        if loc == "direction":
            st = c.find("{*}staff")
            w = c.find(".//{*}words")
            out.append(f"dir(s{st.text if st is not None else '?'}:{w.text if w is not None else 'dyn'})")
        elif loc == "note":
            st = c.find("{*}staff")
            out.append(f"n(s{st.text if st is not None else '?'})")
        elif loc == "backup":
            out.append("backup")
        else:
            out.append(loc)
    return out


r = deepcopy(load())
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
m = next(x for x in r.find('.//{*}part[@id="P5"]').findall("{*}measure") if x.get("number") == "17")
seq = order_label(m)
print("full order:", seq)
print("dir index:", seq.index("dir(s2:poco piu mosso)"))
print("first s2 note index:", next(i for i, x in enumerate(seq) if x == "n(s2)"))
print("backup index:", seq.index("backup"))

# simulate PL-only filter: drop staff1 notes + backup
filtered = []
for c in m:
    loc = _local(c)
    if loc == "backup":
        continue
    if loc == "note":
        st = c.find("{*}staff")
        if st is not None and st.text != "2":
            continue
    if loc == "direction":
        st = c.find("{*}staff")
        if st is not None and st.text != "2":
            continue
    filtered.append(loc + (":s2" if loc in ("note", "direction") else ""))
print("PL-filter child order:", filtered)
