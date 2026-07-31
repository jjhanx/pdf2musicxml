import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fixes_to_root, _note_matching_direction_voice, _ns

def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag

root = ET.fromstring("""<score-partwise version="3.1">
<part id="P5"><measure number="1">
<attributes><divisions>4</divisions><staves>2</staves></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><staff>1</staff></note>
<backup><duration>4</duration></backup>
<note><pitch><step>G</step><octave>2</octave></pitch><duration>4</duration><type>quarter</type><staff>2</staff><voice>5</voice></note>
</measure></part></score-partwise>""")
apply_fixes_to_root(
    root,
    [
        {
            "kind": "insertDirection",
            "partId": "P5",
            "measureMxl": "1",
            "afterNoteIndex": -1,
            "directionType": "words",
            "directionValue": "PL start",
            "staff": 2,
        }
    ],
)
ns = _ns(root)
m = root.find(".//{*}measure")
for i, c in enumerate(m):
    print(i, _local(c.tag))
d = m.find("direction")
print("voice match", _note_matching_direction_voice(m, d, ns) is not None)
