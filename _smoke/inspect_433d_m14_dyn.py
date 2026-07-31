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
    rebuild_measure_timeline_clean,
    _local,
    _note_voice_staff,
    _ns,
)

ZIP = Path(__file__).resolve().parents[1] / "omr-work-433d3ddc.zip"


def load(name: str) -> ET.Element:
    with zipfile.ZipFile(ZIP) as z:
        inner = zipfile.ZipFile(io.BytesIO(z.read(name)))
        return ET.fromstring(inner.read([n for n in inner.namelist() if n.endswith(".xml")][0]))


def dump_m14(root: ET.Element, label: str) -> None:
    part = root.find('.//{*}part[@id="P5"]')
    m = next(x for x in part.findall("{*}measure") if x.get("number") == "14")
    ns = _ns(root)
    print(f"\n=== {label} ===")
    note_i = -1
    for c in m:
        loc = _local(c)
        if loc == "direction":
            st = c.find(f"{{{ns}}}staff") if ns else c.find("{*}staff")
            p = c.find(".//{*}p") is not None or (ns and c.find(f".//{{{ns}}}p") is not None)
            print(f"  direction staff={st.text if st is not None else '?'} p={p}")
        elif loc == "note":
            note_i += 1
            _, st = _note_voice_staff(c, ns)
            if st != "1":
                continue
            pitch = c.find(f"{{{ns}}}pitch") if ns else c.find("{*}pitch")
            rest = c.find(f"{{{ns}}}rest") if ns else c.find("{*}rest")
            p = "rest" if rest is not None else ""
            if pitch is not None:
                step = pitch.find(f"{{{ns}}}step") if ns else pitch.find("{*}step")
                oct_ = pitch.find(f"{{{ns}}}octave") if ns else pitch.find("{*}octave")
                alt = pitch.find(f"{{{ns}}}alter") if ns else pitch.find("{*}alter")
                acc = alt.text if alt is not None else ""
                p = f"{step.text}{acc}{oct_.text}"
            chord = c.find(f"{{{ns}}}chord") if ns else c.find("{*}chord")
            print(
                f"  #{note_i} {p} chord={chord is not None} x={c.get('default-x','')[:8]}"
            )


raw = load("review.mxl")
snap = measure_snapshot(raw, "", "P5", "14")
print("PR staff=1 notes around 18:")
for e in snap["elements"]:
    if e.get("elementKind") == "note" and (e.get("staff") in (1, None)):
        idx = e.get("index", -1)
        if 15 <= idx <= 22:
            print(" ", e)

dump_m14(raw, "before")

r = deepcopy(raw)
apply_fixes_to_root(
    r,
    [
        {
            "kind": "insertDirection",
            "partId": "P5",
            "measureMxl": "14",
            "afterNoteIndex": 18,
            "directionType": "dynamics",
            "directionValue": "p",
            "staff": 1,
        }
    ],
)
dump_m14(r, "after insert after #18")

m = next(
    x for x in r.find('.//{*}part[@id="P5"]').findall("{*}measure") if x.get("number") == "14"
)
rebuild_measure_timeline_clean(m, _ns(r))
dump_m14(r, "after rebuild")
