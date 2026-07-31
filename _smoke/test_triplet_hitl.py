#!/usr/bin/env python3
"""HITL 세잇단 — 4분 3연음·bracket 회귀."""
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fix  # noqa: E402


def _q(ns: str, local: str) -> str:
    return f"{{{ns}}}{local}" if ns else local


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


# 3× quarter in 4/4 — apply 3:2 quarter triplet
xml = """<score-partwise version="3.1">
<part id="P1"><measure number="59">
<attributes><divisions>12</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>12</duration><type>quarter</type></note>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>12</duration><type>quarter</type></note>
<note><pitch><step>E</step><octave>4</octave></pitch><duration>12</duration><type>quarter</type></note>
<note><rest/><duration>12</duration><type>quarter</type></note>
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
        "toNoteIndex": 2,
        "actualNotes": 3,
        "normalNotes": 2,
        "normalType": "quarter",
    },
)

part = root.find(".//{*}part")
measure = part.find("{*}measure")
notes = measure.findall("{*}note")
ns = root.tag.split("}")[0].strip("{") if "}" in root.tag else ""

for n in notes[:3]:
    assert (n.find("{*}type").text or "") == "quarter"
    tm = n.find("{*}time-modification")
    assert tm is not None
    assert tm.find("{*}normal-type").text == "quarter"
    assert int(n.find("{*}duration").text) == 8  # 2 quarters / 3

start = notes[0].find(".//{*}tuplet")
assert start is not None and start.get("type") == "start"
assert start.get("show-bracket") == "yes"
assert start.get("bracket") == "yes"

# beamed eighth triplet — bracket off
beam_xml = """<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>12</divisions></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>eighth</type><beam number="1">begin</beam></note>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>eighth</type><beam number="1">continue</beam></note>
<note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>eighth</type><beam number="1">end</beam></note>
</measure></part></score-partwise>"""
root2 = ET.fromstring(beam_xml)
assert apply_fix(
    root2,
    "",
    {
        "kind": "applyTriplet",
        "partId": "P1",
        "measureMxl": "1",
        "fromNoteIndex": 0,
        "toNoteIndex": 2,
        "actualNotes": 3,
        "normalNotes": 2,
        "normalType": "eighth",
    },
)
notes2 = root2.find(".//{*}measure").findall("{*}note")
tup = notes2[0].find(".//{*}tuplet")
assert tup.get("show-bracket") == "no"

# half + quarter in one triplet (2 noteheads, 3 slots) — preserve types
mixed_xml = """<score-partwise version="3.1">
<part id="P1"><measure number="59">
<attributes><divisions>12</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>C</step><octave>3</octave></pitch><duration>24</duration><type>half</type></note>
<note><pitch><step>E</step><octave>3</octave></pitch><duration>12</duration><type>quarter</type></note>
<note><rest/><duration>12</duration><type>quarter</type></note>
</measure></part></score-partwise>"""
root3 = ET.fromstring(mixed_xml)
assert apply_fix(
    root3,
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
notes3 = root3.find(".//{*}measure").findall("{*}note")
assert (notes3[0].find("{*}type").text or "") == "half"
assert (notes3[1].find("{*}type").text or "") == "quarter"
assert int(notes3[0].find("{*}duration").text) == 16
assert int(notes3[1].find("{*}duration").text) == 8
tm0 = notes3[0].find("{*}time-modification")
assert tm0.find("{*}actual-notes").text == "3"
assert tm0.find("{*}normal-notes").text == "2"
assert tm0.find("{*}normal-type").text == "quarter"
tup3 = notes3[0].find(".//{*}tuplet")
assert tup3 is not None and tup3.get("show-bracket") == "yes"

print("ok")
