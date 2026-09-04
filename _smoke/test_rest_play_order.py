#!/usr/bin/env python3
"""연주순번 자동 전체 재배열은 비활성 — HITL setPlayOrder 보호."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")

from omr_hitl_lib import (  # noqa: E402
    PLAY_ORDER_ATTR,
    apply_fix,
    measure_snapshot,
    normalize_play_orders_including_rests_in_measure,
    _read_play_order,
)

XML = """<score-partwise version="3.1">
<part id="P1">
  <measure number="1">
    <attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><voice>1</voice></note>
    <note><rest/><duration>2</duration><type>quarter</type><voice>1</voice></note>
    <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><voice>1</voice></note>
    <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><voice>1</voice></note>
  </measure>
</part>
</score-partwise>"""

root = ET.fromstring(XML)
ns = ""
notes = root.findall(".//{*}note")
# 사용자가 맞춘 순번(쉼표 비움) — 자동 재배열이 덮어쓰면 안 됨
notes[0].set(PLAY_ORDER_ATTR, "1")
notes[2].set(PLAY_ORDER_ATTR, "2")
notes[3].set(PLAY_ORDER_ATTR, "3")
assert _read_play_order(notes[1]) is None

meas = root.find(".//{*}measure")
assert not normalize_play_orders_including_rests_in_measure(meas, ns)
assert _read_play_order(notes[0]) == 1
assert _read_play_order(notes[1]) is None  # 자동으로 채우지/덮지 않음
assert _read_play_order(notes[2]) == 2
assert _read_play_order(notes[3]) == 3

# Snapshot still loads; displayPlayOrder may fill UI without mutating XML
snap = measure_snapshot(root, ns, "P1", "1")
assert snap is not None
assert _read_play_order(notes[0]) == 1
assert _read_play_order(notes[2]) == 2

assert apply_fix(
    root,
    ns,
    {"kind": "setPlayOrder", "partId": "P1", "measureMxl": "1", "noteIndex": 1, "playOrder": 5},
)
assert _read_play_order(notes[1]) == 5
assert not normalize_play_orders_including_rests_in_measure(meas, ns)
assert _read_play_order(notes[1]) == 5
assert _read_play_order(notes[2]) == 2

print("OK: play-order auto-rebuild disabled; HITL orders preserved")
