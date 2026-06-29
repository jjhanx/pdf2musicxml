import xml.etree.ElementTree as ET
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.omr_hitl_lib import apply_fix, find_part, find_measure, _ns, list_note_elements

NS = "http://www.musicxml.org/ns/partwise/3.1"


def q(tag: str) -> str:
    return f"{{{NS}}}{tag}"


xml = """<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><stem>up</stem></note>
    </measure>
  </part>
</score-partwise>"""
root = ET.fromstring(xml)
ns = _ns(root)
part = find_part(root, ns, "P1")
measure = find_measure(part, ns, "1")
fix = {
    "kind": "insertNote",
    "partId": "P1",
    "measureMxl": "1",
    "pitchStep": "D",
    "pitchOctave": 4,
    "noteType": "quarter",
    "staff": 1,
    "afterNoteIndex": 0,
}
assert apply_fix(root, ns, fix)
notes = list_note_elements(measure, ns)
assert len(notes) == 2
n = notes[1]
print("note1", ET.tostring(n, encoding="unicode"))
print("dur", n.find(q("duration")).text if n.find(q("duration")) is not None else None)
print("order", [c.tag.split("}")[-1] for c in n])
assert n.find(q("duration")) is not None
assert int(n.find(q("duration")).text) > 0
assert n.find(q("voice")) is not None and n.find(q("voice")).text == "1"
assert n.find(q("stem")) is not None
order = [c.tag.split("}")[-1] for c in n]
assert order.index("duration") < order.index("type")
print("ok", order)
