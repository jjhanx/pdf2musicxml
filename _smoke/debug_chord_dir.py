import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fix, apply_fixes_to_root, _ns, rebuild_measure_timeline_clean

root = ET.fromstring(
    """<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>2</divisions></attributes>
<note><pitch><step>B</step><alter>-1</alter><octave>3</octave></pitch><duration>1</duration><type>eighth</type><stem>up</stem></note>
<note><chord/><pitch><step>D</step><alter>-1</alter><octave>4</octave></pitch><duration>1</duration><type>eighth</type><stem>up</stem></note>
<note><chord/><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><stem>up</stem></note>
<note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><stem>up</stem></note>
</measure></part></score-partwise>"""
)

def dump(label, r):
    print("\n", label)
    m = r.find(".//{*}measure")
    for i, c in enumerate(m):
        tag = c.tag.rsplit("}", 1)[-1]
        extra = ""
        if tag == "direction":
            extra = " p=" + str(c.find(".//{*}p") is not None)
        print(i, tag, extra)

r1 = ET.fromstring(ET.tostring(root))
apply_fix(r1, _ns(r1), {
    "kind": "insertDirection", "partId": "P1", "measureMxl": "1",
    "afterNoteIndex": 0, "directionType": "dynamics", "directionValue": "p", "staff": 1,
})
dump("after apply_fix only", r1)

m1 = r1.find(".//{*}measure")
rebuild_measure_timeline_clean(m1, _ns(r1))
dump("after apply_fix + rebuild only", r1)

r2 = ET.fromstring(ET.tostring(root))
apply_fixes_to_root(r2, [{
    "kind": "insertDirection", "partId": "P1", "measureMxl": "1",
    "afterNoteIndex": 0, "directionType": "dynamics", "directionValue": "p", "staff": 1,
}])
dump("after apply_fixes_to_root", r2)
