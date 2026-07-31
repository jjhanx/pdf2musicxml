import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fixes_to_root, apply_fix, _ns, _note_matching_direction_voice

def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag

root = ET.fromstring("""<score-partwise version="3.1">
<part id="P5"><measure number="1">
<attributes><divisions>4</divisions><staves>2</staves></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><staff>1</staff></note>
<backup><duration>4</duration></backup>
<note><pitch><step>G</step><octave>2</octave></pitch><duration>4</duration><type>quarter</type><staff>2</staff><voice>5</voice></note>
</measure></part></score-partwise>""")
ns = _ns(root)
m = root.find(".//{*}measure")
apply_fix(
    root,
    ns,
    {
        "kind": "insertDirection",
        "partId": "P5",
        "measureMxl": "1",
        "afterNoteIndex": -1,
        "directionType": "words",
        "directionValue": "PL start",
        "staff": 2,
    },
)
print("after apply_fix only:")
for i, c in enumerate(m):
    print(i, _local(c.tag))

apply_fixes_to_root(
    root,
    [
        {
            "kind": "insertDirection",
            "partId": "P5",
            "measureMxl": "1",
            "afterNoteIndex": -1,
            "directionType": "words",
            "directionValue": "PL start2",
            "staff": 2,
        }
    ],
)
print("after apply_fixes_to_root (2nd insert):")
for i, c in enumerate(m):
    print(i, _local(c.tag))

d = m.find("direction")
print("voice match", _note_matching_direction_voice(m, d, ns) is not None)
