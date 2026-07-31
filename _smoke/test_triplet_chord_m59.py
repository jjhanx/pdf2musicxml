#!/usr/bin/env python3
"""혼합 세잇단 화음 — voice·default-x·세잇단 해제 회귀."""
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import (  # noqa: E402
    apply_fix,
    apply_fixes_to_root,
    list_note_elements,
    rebuild_measure_timeline_clean,
    _chord_groups_in_order,
    _note_duration,
    _note_voice_staff,
    _ns,
    _q,
)

xml = """<score-partwise version="3.1">
<part id="P4"><measure number="59">
<attributes><divisions>12</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<backup><duration>48</duration></backup>
<note default-x="32"><pitch><step>E</step><octave>3</octave></pitch><duration>24</duration><voice>5</voice><type>half</type><staff>2</staff></note>
<note default-x="32"><chord/><pitch><step>G</step><octave>3</octave></pitch><duration>24</duration><voice>5</voice><type>half</type><staff>2</staff></note>
<note default-x="32"><pitch><step>A</step><octave>3</octave></pitch><duration>12</duration><voice>6</voice><type>quarter</type><staff>2</staff></note>
<note default-x="32"><chord/><pitch><step>C</step><octave>4</octave></pitch><duration>12</duration><voice>6</voice><type>quarter</type><staff>2</staff></note>
<note default-x="32"><pitch><step>B</step><octave>2</octave></pitch><duration>24</duration><voice>5</voice><type>half</type><staff>2</staff></note>
<note default-x="32"><chord/><pitch><step>D</step><octave>3</octave></pitch><duration>24</duration><voice>5</voice><type>half</type><staff>2</staff></note>
<note default-x="32"><pitch><step>E</step><octave>3</octave></pitch><duration>12</duration><voice>6</voice><type>quarter</type><staff>2</staff></note>
<note default-x="32"><chord/><pitch><step>G</step><octave>3</octave></pitch><duration>12</duration><voice>6</voice><type>quarter</type><staff>2</staff></note>
</measure></part></score-partwise>"""
root = ET.fromstring(xml)
ns = _ns(root)
part = root.find(".//{*}part")
measure = part.find("{*}measure")

apply_fixes_to_root(
    root,
    [
        {
            "kind": "applyTriplet",
            "partId": "P4",
            "measureMxl": "59",
            "fromNoteIndex": 0,
            "toNoteIndex": 7,
            "actualNotes": 6,
            "normalNotes": 2,
            "normalType": "quarter",
            "preserveNoteTypes": True,
        }
    ],
)

notes = list_note_elements(measure, ns)
staff2 = [n for n in notes if (_note_voice_staff(n, ns)[1] == "2")]
voices = {_note_voice_staff(n, ns)[0] for n in staff2}
assert len(voices) == 1, f"expected single voice after merge, got {voices}"

xs = []
for grp in _chord_groups_in_order(staff2, ns):
    x = float(grp[0].get("default-x") or "0")
    xs.append(x)
    assert len(set(str(_note_duration(n, ns)) for n in grp)) == 1
assert len(xs) == 4 and len(set(xs)) == 4, f"unique x per group: {xs}"

# tuplet on first quarter leader (#2) — remove from stop side (#3)
assert apply_fix(
    root,
    ns,
    {"kind": "removeTriplet", "partId": "P4", "measureMxl": "59", "fromNoteIndex": 3},
)
rebuild_measure_timeline_clean(measure, ns)
notes2 = list_note_elements(measure, ns)
for n in notes2:
    assert n.find(_q(ns, "time-modification")) is None
    assert n.find(".//{*}tuplet") is None

print("ok")
