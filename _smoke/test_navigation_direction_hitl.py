"""Update navigation direction HITL tests for MusicXML To Coda (words+coda+sound)."""
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fix, measure_snapshot  # noqa: E402


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


root = ET.fromstring(
    """<score-partwise version="3.1">
<part id="P1"><measure number="22">
<attributes><divisions>2</divisions></attributes>
<direction placement="above"><direction-type><words>$5-f</words></direction-type></direction>
<note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type></note>
</measure></part></score-partwise>"""
)
snap_before = measure_snapshot(root, "", "P1", "22")
assert len(snap_before["measureDirections"]) == 1
assert snap_before["measureDirections"][0]["directionType"] == "words"

assert apply_fix(
    root,
    "",
    {"kind": "removeDirection", "partId": "P1", "measureMxl": "22", "directionIndex": 0},
)
assert not root.findall(".//{*}direction")

assert apply_fix(
    root,
    "",
    {
        "kind": "insertDirection",
        "partId": "P1",
        "measureMxl": "22",
        "measureAnchor": "start",
        "directionType": "segno",
        "staff": 1,
        "placement": "above",
    },
)
measure = root.find(".//{*}measure")
segno = measure.find(".//{*}segno")
assert segno is not None
assert measure.find(".//{*}direction").get("placement") == "above"

snap_after = measure_snapshot(root, "", "P1", "22")
nav = [d for d in snap_after["measureDirections"] if d.get("directionType") == "segno"]
assert len(nav) == 1, snap_after["measureDirections"]
assert nav[0]["directionValue"] == "segno"

root2 = ET.fromstring(
    """<score-partwise version="3.1">
<part id="P1"><measure number="30">
<attributes><divisions>2</divisions></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type></note>
</measure></part></score-partwise>"""
)
assert apply_fix(
    root2,
    "",
    {
        "kind": "insertDirection",
        "partId": "P1",
        "measureMxl": "30",
        "measureAnchor": "start",
        "directionType": "coda",
        "staff": 1,
    },
)
children = [_local(c.tag) for c in root2.find(".//{*}measure")]
assert children.index("direction") < children.index("note")
assert root2.find(".//{*}coda") is not None

root3 = ET.fromstring(
    """<score-partwise version="3.1">
<part id="P1"><measure number="40">
<attributes><divisions>2</divisions></attributes>
<direction placement="above"><direction-type><segno/></direction-type></direction>
<note><rest measure="yes"/><duration>2</duration></note>
</measure></part></score-partwise>"""
)
snap3 = measure_snapshot(root3, "", "P1", "40")
assert any(d.get("directionType") == "segno" for d in snap3["measureDirections"]), snap3["measureDirections"]

root4 = ET.fromstring(
    """<score-partwise version="3.1">
<part id="P1"><measure number="36">
<attributes><divisions>2</divisions></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type></note>
<note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type></note>
</measure></part></score-partwise>"""
)
assert apply_fix(
    root4,
    "",
    {
        "kind": "insertDirection",
        "partId": "P1",
        "measureMxl": "36",
        "measureAnchor": "end",
        "directionType": "tocoda",
        "staff": 1,
        "placement": "above",
    },
)
m4 = root4.find(".//{*}measure")
d4 = m4.findall("{*}direction")[-1]
assert d4.find(".//{*}words").text == "To Coda"
assert d4.find(".//{*}coda") is not None
assert d4.find("{*}sound").get("tocoda") == "coda"
assert d4.find(".//{*}tocoda") is None
snap4 = measure_snapshot(root4, "", "P1", "36")
assert any(d.get("directionType") == "tocoda" for d in snap4["measureDirections"])

# D.S. at measure end → before barline; words + segno
root5 = ET.fromstring(
    """<score-partwise version="3.1">
<part id="P1"><measure number="60">
<attributes><divisions>2</divisions></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><staff>1</staff></note>
<backup><duration>2</duration></backup>
<note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><type>quarter</type><staff>2</staff></note>
<barline location="right"><bar-style>light-heavy</bar-style></barline>
</measure>
<measure number="61">
<note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type></note>
</measure></part></score-partwise>"""
)
assert apply_fix(
    root5,
    "",
    {
        "kind": "insertDirection",
        "partId": "P1",
        "measureMxl": "60",
        "measureAnchor": "end",
        "directionType": "dalsegno",
        "staff": 1,
        "placement": "above",
    },
)
m60 = root5.find(".//{*}measure")
assert m60.get("number") == "60"
kids = [_local(c.tag) for c in m60]
assert "direction" in kids
assert kids.index("direction") > kids.index("backup")
assert kids.index("direction") < kids.index("barline")
d5 = m60.find("{*}direction")
assert d5.find(".//{*}words").text == "D.S."
assert d5.find(".//{*}segno") is not None
assert d5.find("{*}sound").get("dalsegno") == "segno"
# must not leak into next measure
m61 = root5.findall(".//{*}measure")[1]
assert m61.find("{*}direction") is None

print("navigation direction hitl ok")
