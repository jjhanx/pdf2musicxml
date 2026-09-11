"""light-heavy 끝 겹세로줄(repeat 없음)도 clearBarlineRepeat로 일반 세로줄로.

Audiveris가 중간 마디에 light-heavy만 넣으면 OSMD가 도돌이처럼 보이는데
예전 UI는 <repeat> 있을 때만 「도돌이표 삭제」를 보여 지울 수 없었다.

Run: python _smoke/test_clear_final_bar_style_hitl.py
"""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import omr_hitl_lib as lib  # noqa: E402

XML = """<?xml version="1.0"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="79">
      <attributes><divisions>1</divisions></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>whole</type><staff>1</staff></note>
      <barline location="left">
        <bar-style>regular</bar-style>
        <ending number="1" type="start"/>
      </barline>
      <barline location="right"><bar-style>light-heavy</bar-style></barline>
    </measure>
  </part>
  <part id="P5">
    <measure number="79">
      <attributes><divisions>1</divisions><staves>2</staves></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>whole</type><staff>1</staff></note>
      <barline location="right"><bar-style>light-heavy</bar-style></barline>
    </measure>
  </part>
</score-partwise>
"""

root = ET.fromstring(XML)
# misplaced left barline after notes → relocate on clear
assert lib.apply_fix(
    root,
    "",
    {
        "kind": "clearBarlineRepeat",
        "partId": "P5",
        "measureMxl": "79",
        "barlineLocation": "right",
        "applyToAllParts": True,
    },
)

for pid in ("P1", "P5"):
    part = lib.find_part(root, "", pid)
    measure = lib.find_measure(part, "", "79")
    right = None
    for bl in measure.findall("{*}barline"):
        if (bl.get("location") or "right") == "right":
            right = bl
    assert right is not None, pid
    style = (right.findtext("{*}bar-style") or "").strip().lower()
    assert style == "regular", (pid, style)
    assert right.find("{*}repeat") is None

# left barline should be before notes after any barline fix on P1
lib.apply_fix(
    root,
    "",
    {
        "kind": "clearBarlineEnding",
        "partId": "P1",
        "measureMxl": "79",
        "barlineLocation": "left",
        "endingNumber": "1",
        "endingType": "start",
    },
)
part1 = lib.find_part(root, "", "P1")
m1 = lib.find_measure(part1, "", "79")
kids = list(m1)
left_i = next(i for i, c in enumerate(kids) if c.tag.endswith("barline") and c.get("location") == "left")
first_note = next(i for i, c in enumerate(kids) if c.tag.endswith("note"))
assert left_i < first_note, (left_i, first_note)

snap = lib.measure_snapshot(root, "", "P5", "79")
assert snap and snap["barlines"]
right_snap = next(b for b in snap["barlines"] if b["location"] == "right")
assert right_snap["barStyle"] == "regular"
assert right_snap["repeatDirection"] is None

print("OK clear final bar style (light-heavy) + relocate left barline")
