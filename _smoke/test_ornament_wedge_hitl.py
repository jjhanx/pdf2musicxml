"""HITL: inverted-mordent 삭제·추가, wedge 시작/끝 삽입·stop 이동."""
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fix, measure_snapshot  # noqa: E402

ROOT_XML = """<score-partwise version="3.1">
<part id="P5"><measure number="5">
<attributes><divisions>4</divisions><staves>2</staves></attributes>
<note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>16th</type><staff>1</staff></note>
<note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>16th</type><staff>1</staff></note>
<note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><type>16th</type><staff>1</staff></note>
<note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>16th</type><staff>1</staff>
<notations><ornaments><inverted-mordent placement="above"/></ornaments></notations></note>
<note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><type>16th</type><staff>1</staff></note>
<note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><type>16th</type><staff>1</staff></note>
</measure></part></score-partwise>"""

root = ET.fromstring(ROOT_XML)
snap = measure_snapshot(root, "", "P5", "5")
assert snap is not None
note3 = snap["notes"][3]
assert any(o.startswith("inverted-mordent") for o in note3.get("ornaments") or []), note3

assert apply_fix(
    root,
    "",
    {"kind": "removeOrnament", "partId": "P5", "measureMxl": "5", "noteIndex": 3, "ornament": "inverted-mordent"},
)
assert root.find(".//{*}inverted-mordent") is None
snap = measure_snapshot(root, "", "P5", "5")
assert not (snap["notes"][3].get("ornaments") or [])

assert apply_fix(
    root,
    "",
    {
        "kind": "addOrnament",
        "partId": "P5",
        "measureMxl": "5",
        "noteIndex": 3,
        "ornament": "inverted-mordent",
        "placement": "above",
    },
)
orn = root.find(".//{*}inverted-mordent")
assert orn is not None and orn.get("placement") == "above"

assert apply_fix(
    root,
    "",
    {
        "kind": "insertWedge",
        "partId": "P5",
        "measureMxl": "5",
        "directionValue": "crescendo",
        "fromNoteIndex": 1,
        "toNoteIndex": 4,
        "staff": 1,
        "placement": "below",
    },
)
wedges = root.findall(".//{*}wedge")
types = [w.get("type") for w in wedges]
assert types.count("crescendo") == 1, types
assert types.count("stop") == 1, types
snap = measure_snapshot(root, "", "P5", "5")
dirs = snap["measureDirections"]
wedge_dirs = [d for d in dirs if d.get("directionType") == "wedge"]
assert {d.get("directionValue") for d in wedge_dirs} == {"crescendo", "stop"}, wedge_dirs

measure = root.find(".//{*}measure")
children = list(measure)
notes = [c for c in children if (c.tag.endswith("note") if "}" in (c.tag or "") else c.tag == "note")]
# stop should sit immediately before note index 4
note4 = notes[4]
stop_el = None
for i, c in enumerate(children):
    if c is note4:
        prev = children[i - 1]
        stop_el = prev.find(".//{*}wedge")
        break
assert stop_el is not None and stop_el.get("type") == "stop"

assert apply_fix(
    root,
    "",
    {
        "kind": "moveWedgeStop",
        "partId": "P5",
        "measureMxl": "5",
        "beforeNoteIndex": 5,
        "staff": 1,
        "placement": "below",
    },
)
measure = root.find(".//{*}measure")
children = list(measure)
notes = [c for c in children if c.tag.endswith("note") or c.tag == "note"]
note5 = notes[5]
stop_el = None
stop_count = 0
for i, c in enumerate(children):
    w = c.find("{*}wedge") if hasattr(c, "find") else None
    tag = c.tag.rsplit("}", 1)[-1] if "}" in (c.tag or "") else c.tag
    if tag == "direction":
        w = None
        for el in c.iter():
            loc = el.tag.rsplit("}", 1)[-1] if "}" in el.tag else el.tag
            if loc == "wedge" and el.get("type") == "stop":
                w = el
                stop_count += 1
        if w is not None and i + 1 < len(children) and children[i + 1] is note5:
            stop_el = w
assert stop_count == 1, stop_count
assert stop_el is not None and stop_el.get("type") == "stop"

print("ornament+wedge hitl ok")
