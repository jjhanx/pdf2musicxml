import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fix, rebuild_measure_timeline_clean, _migrate_directions_to_notes, _ns, _normalize_measure_note_engraving, _strip_chord_member_beams, list_note_elements, find_part

def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag

def dump(m, label):
    print(label)
    for i, c in enumerate(m):
        print(i, _local(c.tag))

root = ET.fromstring("""<score-partwise version="3.1">
<part id="P5"><measure number="1">
<attributes><divisions>4</divisions><staves>2</staves></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><staff>1</staff></note>
<backup><duration>4</duration></backup>
<note><pitch><step>G</step><octave>2</octave></pitch><duration>4</duration><type>quarter</type><staff>2</staff><voice>5</voice></note>
</measure></part></score-partwise>""")
ns = _ns(root)
m = root.find(".//{*}measure")
part = find_part(root, ns, "P5")
apply_fix(root, ns, {"kind":"insertDirection","partId":"P5","measureMxl":"1","afterNoteIndex":-1,"directionType":"words","directionValue":"PL","staff":2})
dump(m, "after apply_fix")
_normalize_measure_note_engraving(part, ns, m)
_strip_chord_member_beams(list_note_elements(m, ns), ns)
dump(m, "after norm")
rebuild_measure_timeline_clean(m, ns)
dump(m, "after rebuild")
for i, c in enumerate(m):
    if _local(c.tag) == "note":
        v = c.find("voice")
        print(i, c.find("pitch/step").text, "voice", v.text if v is not None else None, "staff", c.find("staff").text if c.find("staff") is not None else None)
d = m.find("direction")
print("dir voice", d.find("voice").text if d.find("voice") is not None else None)
from omr_hitl_lib import _note_matching_direction_voice
anchor = _note_matching_direction_voice(m, d, ns)
print("anchor idx", list(m).index(anchor) if anchor is not None else None, "step", anchor.find("pitch/step").text if anchor is not None else None)
_migrate_directions_to_notes(m, ns)
dump(m, "after migrate")
