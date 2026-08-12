#!/usr/bin/env python3
"""Parts without <attributes> in a measure get tempo at measure end, not before notes."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")

from omr_hitl_lib import apply_fix, _local  # noqa: E402

XML = """<score-partwise version="3.1">
<part id="P1">
  <measure number="1">
    <attributes><divisions>1</divisions></attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
  </measure>
</part>
<part id="P2">
  <measure number="1">
    <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
  </measure>
</part>
</score-partwise>"""

root = ET.fromstring(XML)
assert apply_fix(
    root,
    "",
    {"kind": "setMeasureTempo", "partId": "P1", "measureMxl": "1", "tempoBpm": 80, "beatUnit": "quarter"},
)
p1 = next(p for p in root.findall(".//{*}part") if p.get("id") == "P1")
p2 = next(p for p in root.findall(".//{*}part") if p.get("id") == "P2")
m1 = next(m for m in p1.findall(".//{*}measure") if m.get("number") == "1")
m2 = next(m for m in p2.findall(".//{*}measure") if m.get("number") == "1")
tags1 = [_local(c) for c in m1]
tags2 = [_local(c) for c in m2]
print("P1:", tags1)
print("P2:", tags2)
assert tags1.index("attributes") < tags1.index("direction") < tags1.index("note")
assert tags2.index("note") < tags2.index("direction"), f"P2 tempo should be after note: {tags2}"
print("OK: no-attributes part gets tempo after notes")
