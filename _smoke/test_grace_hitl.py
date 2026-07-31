import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fix, apply_fixes_to_root, measure_snapshot  # noqa: E402


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _note_tags(measure: ET.Element) -> list[str]:
    return [_local(c.tag) for c in measure if _local(c.tag) == "note"]


root = ET.fromstring("""<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>2</divisions></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><stem>up</stem></note>
</measure></part></score-partwise>""")

assert apply_fix(
    root,
    "",
    {
        "kind": "insertGraceNote",
        "partId": "P1",
        "measureMxl": "1",
        "beforeNoteIndex": 0,
        "pitchStep": "D",
        "pitchOctave": 4,
        "noteType": "eighth",
        "graceSlash": True,
    },
)
measure = root.find(".//{*}measure")
notes = measure.findall("{*}note")
assert len(notes) == 2
assert notes[0].find("{*}grace") is not None
assert notes[0].find("{*}pitch/{*}step").text == "D"
assert notes[0].find("{*}grace").get("slash") == "yes"
assert notes[1].find("{*}grace") is None
snap = measure_snapshot(root, "", "P1", "1")
assert snap["notes"][0]["hasGrace"] is True

root2 = ET.fromstring("""<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>2</divisions></attributes>
<note><grace slash="yes"/><pitch><step>D</step><octave>4</octave></pitch><type>eighth</type><stem>up</stem></note>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><stem>up</stem></note>
</measure></part></score-partwise>""")
assert apply_fix(
    root2,
    "",
    {"kind": "removeGraceBeforeNote", "partId": "P1", "measureMxl": "1", "beforeNoteIndex": 1},
)
measure2 = root2.find(".//{*}measure")
assert len(measure2.findall("{*}note")) == 1
assert measure2.find("{*}grace") is None

root3 = ET.fromstring("""<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>4</divisions></attributes>
<note><grace slash="yes"/><pitch><step>E</step><octave>4</octave></pitch><type>16th</type><stem>up</stem><staff>1</staff></note>
<note><grace slash="yes"/><pitch><step>D</step><octave>4</octave></pitch><type>16th</type><stem>up</stem><staff>1</staff></note>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><stem>up</stem><staff>1</staff></note>
</measure></part></score-partwise>""")
stats = apply_fixes_to_root(
    root3,
    [{"kind": "removeGraceBeforeNote", "partId": "P1", "measureMxl": "1", "beforeNoteIndex": 2}],
)
assert stats["applied"] == 1
assert len(root3.find(".//{*}measure").findall("{*}note")) == 1

print("grace hitl ok")
