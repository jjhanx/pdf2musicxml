import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fixes_to_root, list_note_elements, _ns, _note_pitch_str  # noqa: E402

xml = """<score-partwise version="3.1">
<part id="P1"><measure number="18">
<attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note default-x="10"><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
<note default-x="50"><rest/><duration>1</duration><voice>1</voice><type>eighth</type><staff>1</staff></note>
<note default-x="80"><rest/><duration>1</duration><voice>1</voice><type>eighth</type><staff>1</staff></note>
</measure></part></score-partwise>"""
root = ET.fromstring(xml)
ns = _ns(root)
fixes = [
    {
        "kind": "insertNote",
        "partId": "P1",
        "measureMxl": "18",
        "pitchStep": "D",
        "pitchOctave": 4,
        "noteType": "eighth",
        "staff": 1,
        "afterNoteIndex": 2,
    }
]
stats = apply_fixes_to_root(root, fixes)
assert stats["applied"] == 1, stats
measure = root.find(".//{*}measure")
notes = list_note_elements(measure, ns)
assert len(notes) == 4, len(notes)
assert _note_pitch_str(notes[-1], ns) == "D4", [
    _note_pitch_str(n, ns) for n in notes
]
x_last = float(notes[-1].get("default-x", "0"))
x_prev = float(notes[-2].get("default-x", "0"))
assert x_last > x_prev, (x_last, x_prev)
print("ok", [(_note_pitch_str(n, ns), n.get("default-x")) for n in notes])
