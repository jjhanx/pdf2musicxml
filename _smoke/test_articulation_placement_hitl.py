"""HITL: tenuto 등 articulation 위/아래 placement."""
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import (  # noqa: E402
    ARTICULATION_STAFF_GAP_BASE,
    apply_fix,
    measure_snapshot,
    normalize_articulations_in_root,
    _calc_safe_articulation_default_y,
    list_note_elements,
    _ns,
    _q,
)

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
assert any(a.startswith("tenuto(above") for a in arts), arts
assert any(a.startswith("staccato(below") for a in arts), arts

# slur(below) + accent(below) — 오선 gap 30×1 (slur와 무관)
slur_accent = ET.fromstring(
    """<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>1</divisions></attributes>
<note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>1</duration>
<type>quarter</type><stem>up</stem>
<notations><slur type="stop" number="1" placement="below"/>
<articulations><accent placement="below"/></articulations></notations></note>
</measure></part></score-partwise>"""
)
ns_sa = _ns(slur_accent)
m = slur_accent.find(".//{*}measure")
note = list_note_elements(m, ns_sa)[0]
dy = _calc_safe_articulation_default_y(note, ns_sa, "below")
assert dy == -ARTICULATION_STAFF_GAP_BASE, dy
normalize_articulations_in_root(slur_accent)
acc = slur_accent.find(".//{*}accent")
assert acc is not None and int(acc.get("default-y")) == -ARTICULATION_STAFF_GAP_BASE

print("articulation placement hitl ok")
