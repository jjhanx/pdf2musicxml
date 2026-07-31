#!/usr/bin/env python3
"""Orphan quarter beam must not suppress mixed triplet bracket."""
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fix, _ns, _q  # noqa: E402

xml = """<score-partwise version="3.1">
<part id="P1"><measure number="59">
<attributes><divisions>12</divisions></attributes>
<note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><type>half</type></note>
<note><pitch><step>E</step><octave>3</octave></pitch><duration>8</duration><type>quarter</type>
<beam number="1">begin</beam></note>
</measure></part></score-partwise>"""
root = ET.fromstring(xml)
assert apply_fix(
    root,
    "",
    {
        "kind": "applyTriplet",
        "partId": "P1",
        "measureMxl": "59",
        "fromNoteIndex": 0,
        "toNoteIndex": 1,
        "actualNotes": 3,
        "normalNotes": 2,
        "normalType": "quarter",
        "preserveNoteTypes": True,
    },
)
notes = root.find(".//{*}measure").findall("{*}note")
tup = notes[0].find(".//{*}tuplet")
assert tup.get("show-bracket") == "yes"
assert notes[1].find("{*}beam") is None
print("ok")
