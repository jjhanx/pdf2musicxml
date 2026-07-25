"""setPlayOrder: same pitch+staff duplicate leaders get the same play order."""
import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import omr_hitl_lib as lib

ZIP = ROOT / "omr-work-0ea5ea52.zip"
with zipfile.ZipFile(ZIP) as z:
    data = z.read("review.mxl")
with zipfile.ZipFile(io.BytesIO(data)) as inner:
    xml = inner.read(
        [n for n in inner.namelist() if n.endswith(".xml") and "META" not in n.upper()][0]
    )
root = ET.fromstring(xml)
lib.apply_fixes_to_root(
    root,
    [
        {"kind": "setPlayOrder", "partId": "P5", "measureMxl": "17", "noteIndex": 0, "playOrder": 2, "staff": 1},
        {"kind": "setPlayOrder", "partId": "P5", "measureMxl": "17", "noteIndex": 3, "playOrder": 2, "staff": 1},
    ],
)
ns = root.tag.split("}")[0] + "}" if "}" in root.tag else ""
part = lib.find_part(root, ns, "P5")
measure = lib.find_measure(part, ns, "17")
notes = lib.list_note_elements(measure, ns)


def pitch(n: ET.Element) -> str:
    return lib._note_pitch_label(n, ns) or "?"


f4_leaders = [
    i
    for i, n in enumerate(notes)
    if pitch(n) == "F4" and n.find(lib._q(ns, "chord")) is None and lib._note_voice_staff(n, ns)[1] == "1"
]
e5_leaders = [
    i
    for i, n in enumerate(notes)
    if pitch(n) == "E5" and n.find(lib._q(ns, "chord")) is None and lib._note_voice_staff(n, ns)[1] == "1"
]
if len(f4_leaders) < 2:
    raise SystemExit(f"expected >=2 F4 leaders on staff 1, got {f4_leaders}")
for i in f4_leaders:
    po = notes[i].get("data-hitl-play-order")
    if po != "2":
        raise SystemExit(f"F4 leader #{i} play order expected 2 got {po}")
for i in e5_leaders:
    po = notes[i].get("data-hitl-play-order")
    if po != "2":
        raise SystemExit(f"E5 leader #{i} play order expected 2 got {po}")
print("OK setPlayOrder propagates to duplicate pitch leaders", {"f4": f4_leaders, "e5": e5_leaders})
