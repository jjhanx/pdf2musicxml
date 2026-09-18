"""applyBeam: 16th + dotted eighth gets beam2 forward hook on the 16th only.

Without the hook, OSMD extends a secondary beam onto the dotted eighth so it
looks like a 16th. Run: python _smoke/test_apply_beam_16th_dotted_eighth_hook.py
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
      <attributes><divisions>4</divisions>
        <clef><sign>F</sign><line>4</line></clef></attributes>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>1</duration><type>16th</type>
        <voice>5</voice><staff>1</staff><stem>up</stem>
      </note>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>3</duration><type>eighth</type><dot/>
        <voice>5</voice><staff>1</staff><stem>up</stem>
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
        "toNoteIndex": 1,
        "beamNumber": 1,
    },
)
assert ok, "applyBeam failed"
notes = [n for n in root.find("{*}part").find("{*}measure").findall("{*}note") if n.find("{*}chord") is None]
b0 = sorted((b.get("number"), (b.text or "").strip()) for b in notes[0].findall("{*}beam"))
b1 = sorted((b.get("number"), (b.text or "").strip()) for b in notes[1].findall("{*}beam"))
assert notes[0].findtext("{*}type") == "16th", notes[0].findtext("{*}type")
assert notes[1].findtext("{*}type") == "eighth" and len(notes[1].findall("{*}dot")) == 1
assert notes[1].findtext("{*}duration") == "3", notes[1].findtext("{*}duration")
assert b0 == [("1", "begin"), ("2", "forward hook")], b0
assert b1 == [("1", "end")], b1
assert not any(b.get("number") == "2" for b in notes[1].findall("{*}beam"))

# reverse order: dotted eighth then 16th → backward hook on 16th
XML2 = XML.replace(
    """<note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>1</duration><type>16th</type>
        <voice>5</voice><staff>1</staff><stem>up</stem>
      </note>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>3</duration><type>eighth</type><dot/>
        <voice>5</voice><staff>1</staff><stem>up</stem>
      </note>""",
    """<note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>3</duration><type>eighth</type><dot/>
        <voice>5</voice><staff>1</staff><stem>up</stem>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>1</duration><type>16th</type>
        <voice>5</voice><staff>1</staff><stem>up</stem>
      </note>""",
)
root2 = ET.fromstring(XML2)
assert lib.apply_fix(
    root2,
    "",
    {
        "kind": "applyBeam",
        "partId": "P1",
        "measureMxl": "4",
        "fromNoteIndex": 0,
        "toNoteIndex": 1,
        "beamNumber": 1,
    },
)
n2 = [n for n in root2.find("{*}part").find("{*}measure").findall("{*}note") if n.find("{*}chord") is None]
assert sorted((b.get("number"), (b.text or "").strip()) for b in n2[0].findall("{*}beam")) == [
    ("1", "begin")
]
assert sorted((b.get("number"), (b.text or "").strip()) for b in n2[1].findall("{*}beam")) == [
    ("1", "end"),
    ("2", "backward hook"),
]
print("test_apply_beam_16th_dotted_eighth_hook: OK")
