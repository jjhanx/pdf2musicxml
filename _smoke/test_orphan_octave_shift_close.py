"""Orphan octave-shift start is closed (or removed) so OSMD/MuseScore stay stable."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import repair_orphan_octave_shifts_in_root  # noqa: E402


def _os_types(measure: ET.Element) -> list[str]:
    out: list[str] = []
    for d in measure.findall("direction"):
        for dt in d.findall("direction-type"):
            o = dt.find("octave-shift")
            if o is not None:
                out.append((o.get("type") or "").strip())
    return out


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
types = _os_types(m)
assert "up" in types and "stop" in types, types
# stop after last note
kids = list(m)
stop_i = next(
    i
    for i, el in enumerate(kids)
    if el.tag == "direction" and el.find("direction-type/octave-shift") is not None
    and el.find("direction-type/octave-shift").get("type") == "stop"
)
last_note_i = max(i for i, el in enumerate(kids) if el.tag == "note")
assert stop_i > last_note_i, (stop_i, last_note_i)

print("ok orphan octave-shift closed")
