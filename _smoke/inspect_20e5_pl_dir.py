import io
import json
import sys
import zipfile
import xml.etree.ElementTree as ET
from copy import deepcopy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import apply_fixes_to_root, measure_snapshot, _local, _ns

ZIP = Path(__file__).resolve().parents[1] / "omr-work-20e53bc4.zip"


def load(name: str = "review.mxl") -> ET.Element:
    with zipfile.ZipFile(ZIP) as z:
        inner = zipfile.ZipFile(io.BytesIO(z.read(name)))
        return ET.fromstring(inner.read([n for n in inner.namelist() if n.endswith(".xml")][0]))


def dump_part_measures(pid: str, nums: list[str], label: str) -> None:
    root = load()
    part = root.find(f'.//{{*}}part[@id="{pid}"]')
    if part is None:
        print(f"no part {pid}")
        return
    print(f"\n=== {label} {pid} ===")
    for num in nums:
        m = next((x for x in part.findall("{*}measure") if x.get("number") == num), None)
        if m is None:
            print(f"  m{num}: missing")
            continue
        head = []
        for c in list(m)[:8]:
            loc = _local(c)
            if loc == "direction":
                st = c.find("{*}staff")
                w = c.find(".//{*}words")
                head.append(f"dir(st={st.text if st is not None else '?'},{w.text if w is not None else '?'})")
            elif loc == "note":
                st = c.find("{*}staff")
                head.append(f"note(st={st.text if st is not None else '?'})")
            elif loc == "backup":
                head.append("backup")
            else:
                head.append(loc)
        tail = []
        for c in list(m)[-3:]:
            loc = _local(c)
            if loc == "direction":
                st = c.find("{*}staff")
                w = c.find(".//{*}words")
                tail.append(f"dir(st={st.text if st is not None else '?'})")
            elif loc == "note":
                st = c.find("{*}staff")
                tail.append(f"note(st={st.text if st is not None else '?'})")
        print(f"  m{num}: {head} ... {tail}")


dump_part_measures("P1", ["17", "18"], "before")
dump_part_measures("P2", ["17", "18"], "before")
dump_part_measures("P5", ["17", "18"], "before")

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
print("\n=== after P5 m17 PL measure-start insert ===")
for pid in ("P1", "P2", "P5"):
    part = r.find(f'.//{{*}}part[@id="{pid}"]')
    for num in ("17", "18"):
        m = next((x for x in part.findall("{*}measure") if x.get("number") == num), None)
        if m is None:
            continue
        dirs = []
        for i, c in enumerate(m):
            if _local(c) == "direction":
                st = c.find("{*}staff")
                w = c.find(".//{*}words")
                dirs.append((i, st.text if st is not None else "?", w.text if w is not None else "?"))
        if dirs:
            print(f"  {pid} m{num} directions: {dirs}")

snap = measure_snapshot(r, _ns(r), "P5", "17")
print("\nP5 m17 snapshot directions:", [e for e in snap["elements"] if e.get("elementKind") == "direction"])
