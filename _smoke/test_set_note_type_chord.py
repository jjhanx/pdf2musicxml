import xml.etree.ElementTree as ET
import sys

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fix, measure_snapshot  # noqa: E402

xml = """<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>2</divisions></attributes>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type></note>
<note><chord/><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type></note>
</measure></part></score-partwise>"""
root = ET.fromstring(xml)
assert apply_fix(
    root,
    "",
    {"kind": "setNoteType", "partId": "P1", "measureMxl": "1", "noteIndex": 0, "noteType": "eighth", "dotCount": 0},
)
snap = measure_snapshot(root, "", "P1", "1")
notes = [e for e in snap["elements"] if e["elementKind"] == "note"]
assert notes[0]["type"] == "eighth"
assert notes[1]["type"] == "eighth"
print("chord type sync ok")
