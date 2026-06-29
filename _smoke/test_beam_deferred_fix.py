import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fixes_to_root, measure_snapshot  # noqa: E402

xml = """<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>2</divisions></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><stem>up</stem></note>
<note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><stem>up</stem></note>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><stem>up</stem></note>
<note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><stem>up</stem></note>
</measure></part></score-partwise>"""
root = ET.fromstring(xml)
fixes = [
    {"kind": "removeNote", "partId": "P1", "measureMxl": "1", "noteIndex": 1},
    {
        "kind": "applyBeam",
        "partId": "P1",
        "measureMxl": "1",
        "fromNoteIndex": 0,
        "toNoteIndex": 2,
        "fromPitch": "D4",
        "toPitch": "B4",
    },
]
stats = apply_fixes_to_root(root, fixes)
assert stats["applied"] == 2, stats
snap = measure_snapshot(root, "", "P1", "1")
notes = [e for e in snap["elements"] if e["elementKind"] == "note"]
assert len(notes) == 3
assert notes[0]["pitch"] == "C4"
assert notes[1]["pitch"] == "D4" and notes[1]["beams"] == ["begin"]
assert notes[2]["pitch"] == "B4" and notes[2]["beams"] == ["end"]
print("deferred beam ok", stats)
