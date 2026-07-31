import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import apply_fix, list_note_elements, _ns, _q

xml = """<score-partwise version="3.1"><part id="P1"><measure number="1">
<attributes><divisions>2</divisions></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type></note>
</measure></part></score-partwise>"""
root = ET.fromstring(xml)
ns = _ns(root)
assert apply_fix(
    root,
    ns,
    {
        "kind": "insertNote",
        "partId": "P1",
        "measureMxl": "1",
        "pitchStep": "E",
        "pitchOctave": 4,
        "noteType": "quarter",
        "dotCount": 1,
        "staff": 1,
        "afterNoteIndex": -1,
    },
)
m = root.find(".//{*}measure")
n = list_note_elements(m, ns)[0]
assert len(n.findall(_q(ns, "dot"))) == 1
assert int(n.find(_q(ns, "duration")).text) == 3

assert apply_fix(
    root,
    ns,
    {
        "kind": "insertRest",
        "partId": "P1",
        "measureMxl": "1",
        "noteType": "half",
        "dotCount": 1,
        "staff": 1,
        "afterNoteIndex": 0,
    },
)
r = list_note_elements(m, ns)[1]
assert r.find(_q(ns, "rest")) is not None
assert len(r.findall(_q(ns, "dot"))) == 1
assert int(r.find(_q(ns, "duration")).text) == 6  # half=4, dotted=6 at divisions=2
print("dotted insert ok")
