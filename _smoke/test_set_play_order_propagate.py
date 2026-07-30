"""setPlayOrder: same pitch+staff만 전파 — **동일 musical onset**의 중복 voice만.

서로 다른 시점의 F4 화음(예: [F4,Bb4] vs [F4,Bb4,D5,F5])은 순번이 독립이어야 한다.
Run: python _smoke/test_set_play_order_propagate.py
"""
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

# User scenario m17 PR staff1:
# #5 [F4,Bb4] → 2, #3 E5 → 2, #4 F5 → 3, #7 [F4,Bb4,D5,F5] → 4
lib.apply_fixes_to_root(
    root,
    [
        {"kind": "setPlayOrder", "partId": "P5", "measureMxl": "17", "noteIndex": 5, "playOrder": 2, "staff": 1},
        {"kind": "setPlayOrder", "partId": "P5", "measureMxl": "17", "noteIndex": 3, "playOrder": 2, "staff": 1},
        {"kind": "setPlayOrder", "partId": "P5", "measureMxl": "17", "noteIndex": 4, "playOrder": 3, "staff": 1},
        {"kind": "setPlayOrder", "partId": "P5", "measureMxl": "17", "noteIndex": 7, "playOrder": 4, "staff": 1},
    ],
)
ns = root.tag.split("}")[0] + "}" if "}" in root.tag else ""
part = lib.find_part(root, ns, "P5")
measure = lib.find_measure(part, ns, "17")
notes = lib.list_note_elements(measure, ns)


def po(i: int) -> str | None:
    return notes[i].get("data-hitl-play-order")


# Chord members inherit leader order
expect = {
    5: "2",
    6: "2",  # Bb4 chord of #5
    3: "2",  # E5
    4: "3",  # F5 beam end
    7: "4",
    8: "4",
    9: "4",
    10: "4",
}
for i, want in expect.items():
    got = po(i)
    if got != want:
        raise SystemExit(f"note #{i} play order expected {want} got {got}")

# Earlier F4 triad (#0) and later chords must NOT be overwritten by #5/#7
if po(0) not in (None,):
    # may be unset — must not be 2 or 4 from propagation
    if po(0) in ("2", "4"):
        raise SystemExit(f"note #0 F4 must not inherit later chord order, got {po(0)}")

# #5 must stay 2 after #7 set to 4 (regression: whole-staff same-pitch overwrite)
if po(5) != "2":
    raise SystemExit(f"[F4,Bb4] #5 must remain playOrder 2, got {po(5)}")
if po(7) != "4":
    raise SystemExit(f"[F4,Bb4,D5,F5] #7 must be playOrder 4, got {po(7)}")

# Claim column: pre-corrupt #0/#5/#7 as 4, then set #7→4 clears other onsets
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
if po(7) != "4":
    raise SystemExit(f"after claim #7 must be 4, got {po(7)}")
if po(0) is not None:
    raise SystemExit(f"after claim #0 must clear conflicting 4, got {po(0)}")
if po(5) is not None:
    raise SystemExit(f"after claim #5 must clear conflicting 4, got {po(5)}")

print(
    "OK setPlayOrder same-onset only + claim column",
    {"po5": po(5), "po3": po(3), "po4": po(4), "po7": po(7), "po0": po(0)},
)
