import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fix, measure_snapshot  # noqa: E402

xml = """<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff><type>eighth</type><stem>down</stem></note>
<note><chord/><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff><type>eighth</type><stem>down</stem></note>
<note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><voice>2</voice><staff>1</staff><type>eighth</type><stem>down</stem></note>
<note><chord/><pitch><step>B</step><octave>5</octave></pitch><duration>1</duration><voice>2</voice><staff>1</staff><type>eighth</type><stem>down</stem></note>
</measure></part></score-partwise>"""
root = ET.fromstring(xml)
assert apply_fix(
    root,
    "",
    {
        "kind": "applyBeam",
        "partId": "P1",
        "measureMxl": "1",
        "fromNoteIndex": 0,
        "toNoteIndex": 2,
        "fromPitch": "D4",
        "toPitch": "B4",
        "fromStaff": 1,
        "toStaff": 1,
    },
)
snap = measure_snapshot(root, "", "P1", "1")
notes = [e for e in snap["elements"] if e["elementKind"] == "note"]
assert notes[0]["beams"] == ["begin"]
assert notes[2]["beams"] == ["end"]
assert notes[2]["voice"] == "1", notes[2]
print("voice unify beam ok")
