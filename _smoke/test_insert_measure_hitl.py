"""HITL insertEmptyMeasureBefore/After — all parts stay aligned."""
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fixes_to_root, find_measure, list_note_elements  # noqa: E402


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _pitch_steps(measure: ET.Element) -> list[str]:
    out: list[str] = []
    for child in measure:
        if _local(child.tag) != "note":
            continue
        step = child.find(".//{*}step")
        if step is not None and step.text:
            out.append(step.text.strip())
    return out


SIMPLE = """<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
</measure>
<measure number="2">
<note><pitch><step>D</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
</measure></part>
<part id="P2"><measure number="1">
<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
</measure>
<measure number="2">
<note><pitch><step>F</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
</measure></part>
</score-partwise>"""

root = ET.fromstring(SIMPLE)
stats = apply_fixes_to_root(
    root,
    [{"kind": "insertEmptyMeasureBefore", "partId": "P1", "measureMxl": "2"}],
)
assert stats["applied"] == 1, stats
p1 = root.find(".//{*}part[@id='P1']")
p2 = root.find(".//{*}part[@id='P2']")
assert p1 is not None and p2 is not None
assert len(p1.findall("{*}measure")) == 3
assert len(p2.findall("{*}measure")) == 3
m2 = find_measure(p1, "", "2")
m3 = find_measure(p1, "", "3")
assert m2 is not None and m3 is not None
assert _pitch_steps(m2) == [], m2
assert _pitch_steps(m3) == ["D"], m3
assert list_note_elements(m2, "")[0].find(".//{*}rest").get("measure") == "yes"

# insert after shifts trailing numbers
root3 = ET.fromstring(SIMPLE)
stats3 = apply_fixes_to_root(
    root3,
    [{"kind": "insertEmptyMeasureAfter", "partId": "P1", "measureMxl": "1"}],
)
assert stats3["applied"] == 1
p1b = root3.find(".//{*}part[@id='P1']")
assert find_measure(p1b, "", "2") is not None
assert find_measure(p1b, "", "3") is not None
assert _pitch_steps(find_measure(p1b, "", "3")) == ["D"]

print("insert measure hitl ok")
