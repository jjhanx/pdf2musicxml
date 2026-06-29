import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fix, measure_snapshot  # noqa: E402

xml = """<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note>
  <pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>eighth</type><stem>down</stem>
</note>
<note>
  <chord/><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>eighth</type><stem>down</stem>
</note>
<note>
  <pitch><step>B</step><octave>4</octave></pitch><duration>4</duration><voice>2</voice><type>eighth</type><stem>up</stem>
</note>
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
    },
)
snap = measure_snapshot(root, "", "P1", "1")
notes = [n for n in snap["elements"] if n["elementKind"] == "note"]
print(notes)
assert notes[0]["beams"] == ["begin"]
assert notes[2]["beams"] == ["end"]
assert notes[0]["duration"] == 2
assert notes[2]["duration"] == 2
assert notes[0]["voice"] == notes[2]["voice"]
assert notes[0]["stem"] == notes[2]["stem"] == "down"
print("ok")
