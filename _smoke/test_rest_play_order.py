#!/usr/bin/env python3
"""Rests participate in play-order; legacy note-only PO is rebuilt with rests."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")

from omr_hitl_lib import (  # noqa: E402
    PLAY_ORDER_ATTR,
    apply_fix,
    measure_snapshot,
    normalize_play_orders_including_rests_in_measure,
    _q,
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
# Legacy: only pitched notes got play order 1,2,3 — rest skipped
notes[0].set(PLAY_ORDER_ATTR, "1")
notes[2].set(PLAY_ORDER_ATTR, "2")
notes[3].set(PLAY_ORDER_ATTR, "3")
assert _read_play_order(notes[1]) is None

meas = root.find(".//{*}measure")
assert normalize_play_orders_including_rests_in_measure(meas, ns)
assert _read_play_order(notes[0]) == 1
assert _read_play_order(notes[1]) == 2  # rest now has order
assert _read_play_order(notes[2]) == 3
assert _read_play_order(notes[3]) == 4

# Snapshot exposes rest playOrder / displayPlayOrder
snap = measure_snapshot(root, ns, "P1", "1")
assert snap is not None
els = snap["elements"]
rest = next(e for e in els if e.get("kind") == "rest")
assert rest.get("playOrder") == 2
assert rest.get("displayPlayOrder") == 2

# setPlayOrder on a rest works
assert apply_fix(
    root,
    ns,
    {"kind": "setPlayOrder", "partId": "P1", "measureMxl": "1", "noteIndex": 1, "playOrder": 5},
)
assert _read_play_order(notes[1]) == 5
# clear back via timeline rebuild detection after resetting pitched POs only
notes[1].attrib.pop(PLAY_ORDER_ATTR, None)
notes[0].set(PLAY_ORDER_ATTR, "1")
notes[2].set(PLAY_ORDER_ATTR, "2")
notes[3].set(PLAY_ORDER_ATTR, "3")
assert normalize_play_orders_including_rests_in_measure(meas, ns)

# Already complete — no rebuild
assert not normalize_play_orders_including_rests_in_measure(meas, ns)

print("OK: rest play-order + legacy rebuild")
