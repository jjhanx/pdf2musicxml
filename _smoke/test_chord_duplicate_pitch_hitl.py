"""화음 내 동일 피치 중복은 하나만 남기고, removeNote는 그 음만 지운다."""
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import (  # noqa: E402
    apply_fix,
    _dedupe_identical_pitches_in_chord_groups,
    _ns,
    list_note_elements,
    rebuild_measure_timeline_clean,
)

DUP_XML = """<score-partwise version="3.1">
<part id="P5"><measure number="7">
<attributes><divisions>2</divisions></attributes>
<note default-x="40"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>half</type><staff>1</staff><voice>1</voice></note>
<note default-x="40"><chord/><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><type>half</type><staff>1</staff><voice>1</voice></note>
<note default-x="40"><chord/><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><type>half</type><staff>1</staff><voice>1</voice></note>
</measure></part></score-partwise>"""


def _pitches(measure):
    ns = ""
    out = []
    for n in list_note_elements(measure, ns):
        p = n.find("pitch")
        ch = n.find("chord") is not None
        out.append((p.findtext("step") + p.findtext("octave"), ch))
    return out


root = ET.fromstring(DUP_XML)
measure = root.find(".//measure")
assert _pitches(measure) == [("C4", False), ("A4", True), ("A4", True)]
assert apply_fix(
    root,
    "",
    {"kind": "removeNote", "partId": "P5", "measureMxl": "7", "noteIndex": 2},
)
assert _pitches(measure) == [("C4", False), ("A4", True)], _pitches(measure)

root2 = ET.fromstring(DUP_XML)
measure2 = root2.find(".//measure")
assert _dedupe_identical_pitches_in_chord_groups(measure2, "") == 1
assert _pitches(measure2) == [("C4", False), ("A4", True)], _pitches(measure2)

# 같은 default-x의 순차 A4를 화음 멤버로 붙이지 않고 중복이면 제거
merge_xml = """<score-partwise version="3.1">
<part id="P5"><measure number="7">
<attributes><divisions>2</divisions><staves>1</staves></attributes>
<note default-x="40.00"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>half</type><staff>1</staff><voice>1</voice></note>
<note default-x="40.00"><chord/><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><type>half</type><staff>1</staff><voice>1</voice></note>
<note default-x="40.00"><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><type>half</type><staff>1</staff><voice>1</voice></note>
</measure></part></score-partwise>"""
root3 = ET.fromstring(merge_xml)
part3 = root3.find(".//part")
measure3 = root3.find(".//measure")
rebuild_measure_timeline_clean(measure3, "", part3)
got = _pitches(measure3)
assert got == [("C4", False), ("A4", True)], got

print("chord duplicate pitch hitl ok")
