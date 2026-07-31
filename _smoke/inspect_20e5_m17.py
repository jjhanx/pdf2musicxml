import io
import json
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import apply_fixes_to_root, measure_snapshot, _local, _ns

ZIP = Path(__file__).resolve().parents[1] / "omr-work-20e53bc4.zip"


def load_mxl(name: str = "review.mxl") -> ET.Element:
    with zipfile.ZipFile(ZIP) as z:
        inner = zipfile.ZipFile(io.BytesIO(z.read(name)))
        return ET.fromstring(inner.read([n for n in inner.namelist() if n.endswith(".xml")][0]))


with zipfile.ZipFile(ZIP) as z:
    fixes = json.loads(z.read("omr_hitl_fixes.json"))
    labels = json.loads(z.read("part_labels.json"))
    print("fixes:", json.dumps(fixes, ensure_ascii=False, indent=2)[:3000])
    print("labels:", labels)

root = load_mxl()
for pid in ("P1", "P2", "P5"):
    part = root.find(f'.//{{*}}part[@id="{pid}"]')
    if part is None:
        continue
    m = next((x for x in part.findall("{*}measure") if x.get("number") == "17"), None)
    if m is None:
        continue
    print(f"\n=== {pid} m17 ===")
    for i, c in enumerate(m):
        loc = _local(c)
        if loc == "direction":
            st = c.find("{*}staff")
            words = c.find(".//{*}words")
            print(
                f"  {i} direction staff={st.text if st is not None else '?'} "
                f"text={words.text if words is not None else '?'}"
            )
        elif loc == "note":
            st = c.find("{*}staff")
            if st is not None:
                print(f"  {i} note staff={st.text}")
        elif loc == "backup":
            print(f"  {i} backup")

# simulate PL measure-start direction on P5
r = load_mxl()
apply_fixes_to_root(
    r,
    [
        {
            "kind": "insertDirection",
            "partId": "P5",
            "measureMxl": "17",
            "afterNoteIndex": -1,
            "directionType": "words",
            "directionValue": "TEST PL START",
            "staff": 2,
        }
    ],
)
m5 = next(x for x in r.find('.//{*}part[@id="P5"]').findall("{*}measure") if x.get("number") == "17")
print("\n=== after insert P5 m17 staff2 measure start ===")
for i, c in enumerate(m5):
    loc = _local(c)
    if loc in ("direction", "backup") or (loc == "note" and c.find("{*}staff") is not None):
        st = c.find("{*}staff")
        extra = ""
        if loc == "direction":
            w = c.find(".//{*}words")
            extra = w.text if w is not None else ""
        print(f"  {i} {loc} staff={st.text if st is not None else '-'} {extra}")
