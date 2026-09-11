"""마디 끝 셈여림 — notations가 아니라 standalone + barline 직전 + measure-anchor.

Run: python _smoke/test_measure_end_dynamics_hitl.py
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
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <note default-x="80">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration><type>whole</type>
        <voice>1</voice>
      </note>
      <barline location="right"><bar-style>light-heavy</bar-style></barline>
    </measure>
  </part>
</score-partwise>
"""

root = ET.fromstring(XML)
assert lib.apply_fix(
    root,
    "",
    {
        "kind": "insertDirection",
        "partId": "P1",
        "measureMxl": "1",
        "directionType": "dynamics",
        "directionValue": "mf",
        "measureAnchor": "end",
        "staff": 1,
        "placement": "below",
    },
)
measure = root.find(".//{*}measure")
notes = measure.findall("{*}note")
assert notes[0].find("{*}notations") is None, "must not attach dynamics to note"
dirs = [c for c in measure if c.tag.rsplit("}", 1)[-1] == "direction"]
assert len(dirs) == 1
assert dirs[0].get(lib.MEASURE_END_ANCHOR_ATTR) == "end"
assert dirs[0].get("default-x"), "measure-end default-x hint required"
dx = float(dirs[0].get("default-x"))
assert dx > 80.0, f"default-x should be right of last note, got {dx}"
dyn = dirs[0].find(".//{*}dynamics/{*}mf")
assert dyn is not None
# direction before right barline
children = list(measure)
assert children.index(dirs[0]) < children.index(measure.find("{*}barline"))

# words at measure end also annotated
assert lib.apply_fix(
    root,
    "",
    {
        "kind": "insertDirection",
        "partId": "P1",
        "measureMxl": "1",
        "directionType": "words",
        "directionValue": "rit.",
        "measureAnchor": "end",
        "staff": 1,
        "placement": "above",
    },
)
dirs2 = [c for c in measure if c.tag.rsplit("}", 1)[-1] == "direction"]
assert len(dirs2) == 2
words_dir = [d for d in dirs2 if d.find(".//{*}words") is not None][0]
assert words_dir.get(lib.MEASURE_END_ANCHOR_ATTR) == "end"
assert words_dir.find("{*}notations") is None
assert notes[0].find("{*}notations") is None

# barline repeat still works
assert lib.apply_fix(
    root,
    "",
    {
        "kind": "setBarlineRepeat",
        "partId": "P1",
        "measureMxl": "1",
        "barlineLocation": "right",
        "repeatDirection": "backward",
    },
)
bl = measure.find("{*}barline")
assert bl.find("{*}repeat").get("direction") == "backward"
assert lib.apply_fix(
    root,
    "",
    {
        "kind": "clearBarlineRepeat",
        "partId": "P1",
        "measureMxl": "1",
        "barlineLocation": "right",
    },
)
assert bl.find("{*}repeat") is None

print("OK measure-end dynamics + words + barline repeat")
