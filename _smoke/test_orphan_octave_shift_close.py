"""Orphan octave-shift start is removed (not auto-closed into a fake 8va)."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import repair_orphan_octave_shifts_in_root  # noqa: E402

root = ET.fromstring(
    """<score-partwise version="3.1">
<part id="P1">
  <measure number="39">
    <attributes><divisions>1</divisions></attributes>
    <direction placement="above"><direction-type><octave-shift type="up" size="8" number="1">8va</octave-shift></direction-type><staff>1</staff></direction>
    <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>eighth</type><voice>1</voice></note>
    <note><pitch><step>A</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><voice>1</voice></note>
  </measure>
</part>
</score-partwise>"""
)

n = repair_orphan_octave_shifts_in_root(root)
assert n >= 1, n
m = root.find("./part/measure[@number='39']")
assert m is not None
assert m.find(".//octave-shift") is None, ET.tostring(m, encoding="unicode")
assert len(m.findall("note")) == 2

print("ok orphan octave-shift removed")
