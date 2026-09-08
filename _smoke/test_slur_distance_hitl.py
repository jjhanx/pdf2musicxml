#!/usr/bin/env python3
"""이음줄 거리 HITL 적용 — slur default-y/data-hitl-slur-distance."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import (  # noqa: E402
    DIR_DISTANCE_ATTR,
    SLUR_DISTANCE_ATTR,
    _note_slur_placements,
    _set_slur_pair_placement,
    list_note_elements,
)


measure = ET.fromstring(
    """
<measure number="53">
  <note>
    <pitch><step>C</step><octave>4</octave></pitch>
    <duration>1</duration>
    <notations><slur type="start" number="1" placement="below"/></notations>
  </note>
  <note>
    <pitch><step>D</step><octave>4</octave></pitch>
    <duration>1</duration>
    <notations><slur type="stop" number="1" placement="below"/></notations>
  </note>
</measure>
"""
)

notes = list_note_elements(measure, "")
assert _set_slur_pair_placement(notes, "", 0, "start", "below", "3", True)

start = notes[0].find("./notations/slur")
stop = notes[1].find("./notations/slur")
assert start is not None
assert stop is not None
for slur in (start, stop):
    assert slur.get("placement") == "below"
    assert slur.get("default-y") == "-30"
    assert slur.get(SLUR_DISTANCE_ATTR) == "3"
    assert slur.get(DIR_DISTANCE_ATTR) == "3"

start_pl, stop_pl, start_dist, stop_dist, start_y, stop_y = _note_slur_placements(notes[0], "")
assert start_pl == "below"
assert stop_pl is None
assert start_dist == "3"
assert stop_dist is None
assert start_y == -30
assert stop_y is None

assert _set_slur_pair_placement(notes, "", 0, "start", "above", None, True)
for slur in (start, stop):
    assert slur.get("placement") == "above"
    assert slur.get("default-y") == "10"
    assert slur.get(SLUR_DISTANCE_ATTR) is None
    assert slur.get(DIR_DISTANCE_ATTR) is None

print("slur distance hitl ok")
