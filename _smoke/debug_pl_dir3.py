import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import (
    apply_fix,
    rebuild_measure_timeline_clean,
    _migrate_directions_to_notes,
    _normalize_measure_note_engraving,
    _strip_chord_member_beams,
    _ns,
    list_note_elements,
    find_part,
)

def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag

root = ET.fromstring("""<score-partwise version="3.1">
<part id="P5"><measure number="1">
<attributes><divisions>4</divisions><staves>2</staves></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><staff>1</staff></note>
<backup><duration>4</duration></backup>
<note><pitch><step>G</step><octave>2</octave></pitch><duration>4</duration><type>quarter</type><staff>2</staff><voice>5</voice></note>
</measure></part></score-partwise>""")
ns = _ns(root)
measure = root.find(".//{*}measure")
notes = list_note_elements(measure, ns)
apply_fix(
    root,
    ns,
    {
        "kind": "insertDirection",
        "partId": "P5",
        "measureMxl": "1",
        "afterNoteIndex": -1,
        "directionType": "words",
        "directionValue": "PL start",
        "staff": 2,
    },
)
print("after apply_fix:")
for i, c in enumerate(measure):
    print(i, _local(c.tag))

part = find_part(root, ns, "P5")
_normalize_measure_note_engraving(part, ns, measure)
notes = list_note_elements(measure, ns)
_strip_chord_member_beams(notes, ns)
print("after normalize+strip:")
for i, c in enumerate(measure):
    print(i, _local(c.tag))

rebuild_measure_timeline_clean(measure, ns)
print("after rebuild:")
for i, c in enumerate(measure):
    print(i, _local(c.tag))

from omr_hitl_lib import _direction_effective_staff, _anchor_note_for_existing_direction, _local as L, _note_staff_number
for d in measure.findall("direction"):
    v = d.find("voice")
    want = (v.text or "").strip() if v is not None else None
    print('dir voice', want)
    for child in measure:
        if L(child.tag) != "note":
            continue
        vn = child.find("voice")
        print(" note staff", _note_staff_number(child, ns), "voice", (vn.text if vn is not None else None))
    es = _direction_effective_staff(measure, d, ns, 1)
    a = _anchor_note_for_existing_direction(measure, d, ns, es)
    v = d.find(f"{{{ns}}}voice")
    print("pre-migrate eff_staff", es, "anchor staff", a.find(f"{{{ns}}}staff").text if a is not None else None, "voice", v.text if v is not None else None)

_migrate_directions_to_notes(measure, ns)
print("after migrate:")
for i, c in enumerate(measure):
    print(i, _local(c.tag))
