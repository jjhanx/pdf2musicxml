import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fixes_to_root

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
m = root.find(".//{*}measure")
for i, c in enumerate(m):
    tag = _local(c.tag)
    extra = ""
    if tag == "direction":
        v = c.find("{*}voice")
        st = c.find("{*}staff")
        extra = f" voice={v.text if v is not None else None} staff={st.text if st is not None else None}"
    if tag == "note":
        st = c.find("{*}staff")
        extra = f" staff={st.text if st is not None else None}"
    print(i, tag, extra)
