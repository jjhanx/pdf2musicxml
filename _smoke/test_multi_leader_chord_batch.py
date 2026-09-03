"""여러 리더에 한 배치로 화음 추가 시 각 리더에만 붙는지·일괄 chordMembers 검증."""
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fixes_to_root, list_note_elements  # noqa: E402

TWO_LEADERS = """<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>2</divisions></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><staff>1</staff><voice>1</voice></note>
<note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><staff>1</staff><voice>1</voice></note>
</measure></part></score-partwise>"""


def _pitches(measure):
    out = []
    for n in list_note_elements(measure, ""):
        p = n.find("pitch")
        ch = n.find("chord") is not None
        out.append((p.findtext("step") + p.findtext("octave"), ch))
    return out


root = ET.fromstring(TWO_LEADERS)
stats = apply_fixes_to_root(
    root,
    [
        {
            "kind": "insertChordMember",
            "partId": "P1",
            "measureMxl": "1",
            "leaderNoteIndex": 0,
            "staff": 1,
            "leaderPitchStep": "C",
            "leaderPitchOctave": 4,
            "leaderPitchAlter": 0,
            "chordMembers": [
                {"pitchStep": "E", "pitchOctave": 4, "pitchAlter": 0},
                {"pitchStep": "G", "pitchOctave": 4, "pitchAlter": 0},
            ],
        },
        {
            "kind": "insertChordMember",
            "partId": "P1",
            "measureMxl": "1",
            "leaderNoteIndex": 1,
            "staff": 1,
            "leaderPitchStep": "E",
            "leaderPitchOctave": 4,
            "leaderPitchAlter": 0,
            "chordMembers": [
                {"pitchStep": "G", "pitchOctave": 4, "pitchAlter": 0},
                {"pitchStep": "B", "pitchOctave": 4, "pitchAlter": 0},
            ],
        },
    ],
)
assert stats.get("applied", 0) >= 2, stats
measure = root.find(".//measure")
got = _pitches(measure)
# 높은 leaderNoteIndex부터 적용해도 피치 매칭으로 각 리더에 붙음
assert got == [
    ("C4", False),
    ("E4", True),
    ("G4", True),
    ("E4", False),
    ("G4", True),
    ("B4", True),
], got

# insertNote + chordMembers 한 번에
root2 = ET.fromstring(
    """<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>2</divisions></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><staff>1</staff><voice>1</voice></note>
</measure></part></score-partwise>"""
)
stats2 = apply_fixes_to_root(
    root2,
    [
        {
            "kind": "insertNote",
            "partId": "P1",
            "measureMxl": "1",
            "afterNoteIndex": 0,
            "pitchStep": "D",
            "pitchOctave": 4,
            "noteType": "quarter",
            "staff": 1,
            "voice": "1",
            "chordMembers": [
                {"pitchStep": "F", "pitchOctave": 4},
                {"pitchStep": "A", "pitchOctave": 4},
            ],
        }
    ],
)
assert stats2.get("applied", 0) >= 1, stats2
got2 = _pitches(root2.find(".//measure"))
assert got2 == [
    ("C4", False),
    ("D4", False),
    ("F4", True),
    ("A4", True),
], got2

print("multi leader chord batch ok")
