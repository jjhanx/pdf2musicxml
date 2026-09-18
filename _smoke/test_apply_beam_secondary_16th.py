"""applyBeam on eighth+16th+16th also writes beam number 2 on the 16ths.

Run: python _smoke/test_apply_beam_secondary_16th.py
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
  <part-list><score-part id="P1"><part-name/></score-part></part-list>
  <part id="P1">
    <measure number="4">
      <attributes><divisions>4</divisions><staves>1</staves>
        <clef><sign>F</sign><line>4</line></clef></attributes>
      <note>
        <pitch><step>D</step><octave>3</octave></pitch>
        <duration>2</duration><type>eighth</type>
        <voice>1</voice><staff>1</staff><stem>up</stem>
      </note>
      <note>
        <pitch><step>A</step><octave>3</octave></pitch>
        <duration>1</duration><type>16th</type>
        <voice>1</voice><staff>1</staff><stem>up</stem>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>1</duration><type>16th</type>
        <voice>1</voice><staff>1</staff><stem>up</stem>
      </note>
      <note>
        <pitch><step>C</step><octave>3</octave></pitch>
        <duration>12</duration><type>half</type><dot/>
        <voice>1</voice><staff>1</staff>
      </note>
    </measure>
  </part>
</score-partwise>
"""

root = ET.fromstring(XML)
ok = lib.apply_fix(
    root,
    "",
    {
        "kind": "applyBeam",
        "partId": "P1",
        "measureMxl": "4",
        "fromNoteIndex": 0,
        "toNoteIndex": 2,
        "beamNumber": 1,
    },
)
assert ok, "applyBeam failed"
part = root.find("{*}part")
m = part.find("{*}measure")
notes = [n for n in m.findall("{*}note") if n.find("{*}chord") is None]
beams = []
for n in notes[:3]:
    beams.append(
        sorted(
            (b.get("number"), (b.text or "").strip())
            for b in n.findall("{*}beam")
        )
    )
assert beams[0] == [("1", "begin")], beams[0]
assert ("1", "continue") in beams[1] and ("2", "begin") in beams[1], beams[1]
assert ("1", "end") in beams[2] and ("2", "end") in beams[2], beams[2]
print("test_apply_beam_secondary_16th: OK", beams)
