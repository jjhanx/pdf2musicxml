#!/usr/bin/env python3
"""Measure 1 tempo must appear after attributes (OSMD ghost measure prevention)."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")

from omr_hitl_lib import apply_fix, _local  # noqa: E402

XML = """<score-partwise version="3.1">
<part id="P1">
  <measure number="1">
    <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
  </measure>
</part>
</score-partwise>"""

root = ET.fromstring(XML)
assert apply_fix(
    root,
    "",
    {
        "kind": "setMeasureTempo",
        "partId": "P1",
        "measureMxl": "1",
        "tempoBpm": 120,
        "beatUnit": "quarter",
    },
)
meas = root.find(".//{*}measure")
tags = [_local(c) for c in meas]
print("order:", tags)
assert tags.index("attributes") < tags.index("direction"), f"tempo before attributes: {tags}"
assert tags.index("direction") < tags.index("note"), f"tempo after note: {tags}"

# attributes 앞에 잘못 놓인 tempo도 재배치
bad = ET.fromstring(
    """<score-partwise version="3.1"><part id="P1"><measure number="1">
    <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>60</per-minute></metronome></direction-type><sound tempo="60"/></direction>
    <attributes><divisions>1</divisions></attributes>
    <note><rest/><duration>1</duration><type>quarter</type></note>
  </measure></part></score-partwise>"""
)
apply_fix(
    bad,
    "",
    {"kind": "setMeasureTempo", "partId": "P1", "measureMxl": "1", "tempoBpm": 88, "beatUnit": "quarter"},
)
meas2 = bad.find(".//{*}measure")
tags2 = [_local(c) for c in meas2]
print("reposition order:", tags2)
assert tags2.index("attributes") < tags2.index("direction"), tags2

print("OK: m1 tempo after attributes")
