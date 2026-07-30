"""4637986c: 옛 same-pitch 전파로 m17 F4 화음 3개가 모두 po=4인 잔여 정리 + timeline 기본 순번.

Run: python _smoke/test_play_order_sanitize_4637986c.py
"""
from __future__ import annotations

import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import omr_hitl_lib as lib

ZIP = ROOT / "omr-work-4637986c.zip"
with zipfile.ZipFile(ZIP) as z:
    data = z.read("review.mxl")
with zipfile.ZipFile(io.BytesIO(data)) as inner:
    xml = inner.read(
        [n for n in inner.namelist() if n.endswith(".xml") and "META" not in n.upper()][0]
    )
root = ET.fromstring(xml)
ns = root.tag.split("}")[0] + "}" if "}" in root.tag else ""
part = lib.find_part(root, ns, "P5")
measure = lib.find_measure(part, ns, "17")
notes = lib.list_note_elements(measure, ns)

# Before: opening / [F4,Bb4] / tetra all have po=4 (corrupt propagation residue)
assert notes[0].get("data-hitl-play-order") == "4"
assert notes[5].get("data-hitl-play-order") == "4"
assert notes[7].get("data-hitl-play-order") == "4"

els = lib.measure_elements_snapshot(measure, ns)
# sanitize runs inside snapshot — attrs cleared
assert notes[0].get("data-hitl-play-order") is None
assert notes[5].get("data-hitl-play-order") is None
assert notes[7].get("data-hitl-play-order") is None

by_idx = {int(e["index"]): e for e in els if e.get("staff") == 1 and not e.get("chord")}
# timeline defaults: onset0=1, onset2(E5+[F4,Bb4])=2, F5=3, tetra=4, G=5
assert by_idx[0]["defaultPlayOrder"] == 1, by_idx[0]
assert by_idx[5]["defaultPlayOrder"] == 2, by_idx[5]
assert by_idx[3]["defaultPlayOrder"] == 2, by_idx[3]
assert by_idx[4]["defaultPlayOrder"] == 3, by_idx[4]
assert by_idx[7]["defaultPlayOrder"] == 4, by_idx[7]
assert by_idx[11]["defaultPlayOrder"] == 5, by_idx[11]
assert by_idx[0]["displayPlayOrder"] == 1
assert by_idx[5]["displayPlayOrder"] == 2

# setPlayOrder claim: assigning 4 to tetra must not leave other onsets at 4
# re-corrupt then set
for i in (0, 5, 7):
    notes[i].set("data-hitl-play-order", "4")
lib.apply_fixes_to_root(
    root,
    [
        {
            "kind": "setPlayOrder",
            "partId": "P5",
            "measureMxl": "17",
            "noteIndex": 7,
            "playOrder": 4,
            "staff": 1,
        }
    ],
)
assert notes[7].get("data-hitl-play-order") == "4"
assert notes[0].get("data-hitl-play-order") is None
assert notes[5].get("data-hitl-play-order") is None

print(
    "OK sanitize+timeline defaults 4637986c",
    {
        "d0": by_idx[0]["defaultPlayOrder"],
        "d5": by_idx[5]["defaultPlayOrder"],
        "d3": by_idx[3]["defaultPlayOrder"],
        "d7": by_idx[7]["defaultPlayOrder"],
    },
)
