"""HITL setArticulationPlacement must persist distance + default-y."""
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import (  # noqa: E402
    ART_DISTANCE_ATTR,
    apply_fix,
    _ns,
)

root = ET.fromstring(
    """<score-partwise version="3.1">
<part id="P1"><measure number="1">
<note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch>
<duration>1</duration><type>quarter</type><stem>up</stem>
<notations><articulations><accent placement="below"/></articulations></notations>
</note></measure></part></score-partwise>"""
)
ok = apply_fix(
    root,
    _ns(root),
    {
        "kind": "setArticulationPlacement",
        "partId": "P1",
        "measureMxl": "1",
        "noteIndex": 0,
        "articulation": "accent",
        "placement": "below",
        "distance": "5",
    },
)
acc = root.find(".//{*}accent")
assert ok, "apply_fix returned False"
assert acc is not None
assert acc.get("placement") == "below"
assert acc.get("default-y") == "-50", acc.get("default-y")
assert acc.get(ART_DISTANCE_ATTR) == "5", acc.attrib
print("setArticulationPlacement distance=5 ok", acc.attrib)
