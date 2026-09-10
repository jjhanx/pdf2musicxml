# -*- coding: utf-8 -*-
"""꾸밈음을 화음으로 넣을 수 있는지 — insertChordMember / insertGraceNote asChord.

Run: python _smoke/test_grace_chord_hitl.py
"""
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fix, apply_fixes_to_root, list_note_elements, measure_snapshot  # noqa: E402


def _pitch(note: ET.Element) -> str:
    p = note.find("{*}pitch")
    return (p.findtext("{*}step") or "?") + (p.findtext("{*}octave") or "?")


def _flags(note: ET.Element) -> tuple[bool, bool, bool]:
    return (
        note.find("{*}grace") is not None,
        note.find("{*}chord") is not None,
        note.find("{*}duration") is not None,
    )


# 1) 기존 꾸밈음 리더에 화음 멤버 추가
root = ET.fromstring(
    """<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>2</divisions></attributes>
<note><grace slash="yes"/><pitch><step>D</step><octave>5</octave></pitch><type>16th</type><stem>up</stem><staff>1</staff><voice>1</voice></note>
<note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><type>quarter</type><stem>up</stem><staff>1</staff><voice>1</voice></note>
</measure></part></score-partwise>"""
)
assert apply_fix(
    root,
    "",
    {
        "kind": "insertChordMember",
        "partId": "P1",
        "measureMxl": "1",
        "leaderNoteIndex": 0,
        "staff": 1,
        "leaderVoice": "1",
        "leaderPitchStep": "D",
        "leaderPitchOctave": 5,
        "leaderPitchAlter": 0,
        "chordMembers": [{"pitchStep": "F", "pitchOctave": 5, "pitchAlter": 0}],
    },
)
notes = list_note_elements(root.find(".//{*}measure"), "")
assert [(_pitch(n), *_flags(n)) for n in notes] == [
    ("D5", True, False, False),
    ("F5", True, True, False),
    ("C5", False, False, True),
], [(_pitch(n), *_flags(n)) for n in notes]
assert notes[1].find("{*}grace").get("slash") == "yes"
snap = measure_snapshot(root, "", "P1", "1")
grace_snaps = [n for n in snap["notes"] if n.get("hasGrace")]
assert [n.get("pitch") for n in grace_snaps] == ["D5", "F5"], snap["notes"]
assert grace_snaps[0]["chord"] is False and grace_snaps[1]["chord"] is True
assert grace_snaps[0].get("displayPlayOrder") == grace_snaps[1].get("displayPlayOrder")

# 2) 본음 앞에 화음 꾸밈음 한 번에 삽입 (asChord)
root2 = ET.fromstring(
    """<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>2</divisions></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><stem>up</stem><staff>1</staff><voice>1</voice></note>
</measure></part></score-partwise>"""
)
assert apply_fix(
    root2,
    "",
    {
        "kind": "insertGraceNote",
        "partId": "P1",
        "measureMxl": "1",
        "beforeNoteIndex": 0,
        "asChord": True,
        "beamGraceNotes": False,
        "graceNotes": [
            {"pitchStep": "E", "pitchOctave": 4, "noteType": "16th", "graceSlash": True},
            {"pitchStep": "G", "pitchOctave": 4, "noteType": "16th", "graceSlash": True},
        ],
    },
)
notes2 = list_note_elements(root2.find(".//{*}measure"), "")
assert [(_pitch(n), *_flags(n)) for n in notes2] == [
    ("E4", True, False, False),
    ("G4", True, True, False),
    ("C4", False, False, True),
], [(_pitch(n), *_flags(n)) for n in notes2]
assert notes2[0].get("default-x") == notes2[1].get("default-x")
assert notes2[0].findall("{*}beam") == []
assert notes2[1].findall("{*}beam") == []

# 3) 같은 피치 본음·꾸밈음이 있어도 본음 화음은 본음에만
root3 = ET.fromstring(
    """<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>2</divisions></attributes>
<note><grace slash="yes"/><pitch><step>C</step><octave>4</octave></pitch><type>16th</type><stem>up</stem><staff>1</staff><voice>1</voice></note>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><stem>up</stem><staff>1</staff><voice>1</voice></note>
</measure></part></score-partwise>"""
)
stats = apply_fixes_to_root(
    root3,
    [
        {
            "kind": "insertChordMember",
            "partId": "P1",
            "measureMxl": "1",
            "leaderNoteIndex": 1,
            "staff": 1,
            "leaderVoice": "1",
            "leaderPitchStep": "C",
            "leaderPitchOctave": 4,
            "leaderPitchAlter": 0,
            "chordMembers": [{"pitchStep": "E", "pitchOctave": 4, "pitchAlter": 0}],
        }
    ],
)
assert stats.get("applied", 0) == 1, stats
notes3 = list_note_elements(root3.find(".//{*}measure"), "")
assert [(_pitch(n), *_flags(n)) for n in notes3] == [
    ("C4", True, False, False),
    ("C4", False, False, True),
    ("E4", False, True, True),
], [(_pitch(n), *_flags(n)) for n in notes3]

print("grace chord hitl ok")
