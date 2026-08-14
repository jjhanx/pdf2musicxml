"""HITL: tenuto 등 articulation 위/아래 placement."""
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fix, measure_snapshot  # noqa: E402

root = ET.fromstring(
    """<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>1</divisions></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><stem>up</stem>
<notations><articulations><tenuto placement="below"/></articulations></notations></note>
</measure></part></score-partwise>"""
)

assert apply_fix(
    root,
    "",
    {
        "kind": "setArticulationPlacement",
        "partId": "P1",
        "measureMxl": "1",
        "noteIndex": 0,
        "articulation": "tenuto",
        "placement": "above",
    },
)
ten = root.find(".//{*}tenuto")
assert ten is not None and ten.get("placement") == "above"

assert apply_fix(
    root,
    "",
    {
        "kind": "addArticulation",
        "partId": "P1",
        "measureMxl": "1",
        "noteIndex": 0,
        "articulation": "staccato",
        "placement": "below",
    },
)
st = root.find(".//{*}staccato")
assert st is not None and st.get("placement") == "below"

snap = measure_snapshot(root, "", "P1", "1")
arts = snap["notes"][0]["articulations"]
assert any(a.startswith("tenuto(above)") for a in arts), arts
assert any(a.startswith("staccato(below)") for a in arts), arts

print("articulation placement hitl ok")
