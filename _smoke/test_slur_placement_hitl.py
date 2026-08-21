# -*- coding: utf-8 -*-
"""HITL: 이음줄 placement 위/아래 (addSlur · setSlurPlacement)."""
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fix, measure_snapshot  # noqa: E402

root = ET.fromstring(
    """<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>1</divisions></attributes>
<note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type><stem>up</stem></note>
<note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><stem>up</stem></note>
</measure></part></score-partwise>"""
)

assert apply_fix(
    root,
    "",
    {
        "kind": "addSlur",
        "partId": "P1",
        "measureMxl": "1",
        "fromNoteIndex": 0,
        "toNoteIndex": 1,
        "placement": "above",
    },
)
slurs = root.findall(".//{*}slur")
assert len(slurs) == 2
assert all(s.get("placement") == "above" for s in slurs), [s.attrib for s in slurs]

assert apply_fix(
    root,
    "",
    {
        "kind": "setSlurPlacement",
        "partId": "P1",
        "measureMxl": "1",
        "noteIndex": 0,
        "slurEnd": "start",
        "placement": "below",
    },
)
slurs = root.findall(".//{*}slur")
assert all(s.get("placement") == "below" for s in slurs), [s.attrib for s in slurs]

snap = measure_snapshot(root, "", "P1", "1")
notes = snap.get("notes") or snap.get("elements") or []
# measure_snapshot shape may use elements
if not notes and "elements" in (snap or {}):
    notes = snap["elements"]
# find note dicts
els = snap.get("elements") if isinstance(snap, dict) else None
if els is None and isinstance(snap, dict):
    # older API
    for k in ("notes", "items"):
        if k in snap:
            els = snap[k]
            break
assert els, snap.keys() if isinstance(snap, dict) else snap
n0 = next(e for e in els if e.get("kind") == "note" and e.get("index") == 0)
n1 = next(e for e in els if e.get("kind") == "note" and e.get("index") == 1)
assert n0.get("slurStart") and n0.get("slurStartPlacement") == "below", n0
assert n1.get("slurStop") and n1.get("slurStopPlacement") == "below", n1
print("slur placement hitl ok")
