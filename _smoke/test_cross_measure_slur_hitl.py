# -*- coding: utf-8 -*-
"""Cross-measure slur (start m.N, stop m.N+1)."""
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fix, normalize_slurs_in_root  # noqa: E402


def slurs_on(note: ET.Element) -> list[tuple[str, str]]:
    out = []
    notations = note.find("{*}notations")
    if notations is None:
        return out
    for s in notations.findall("{*}slur"):
        out.append(((s.get("type") or "").strip(), (s.get("number") or "1").strip()))
    return out


root = ET.fromstring(
    """<score-partwise version="3.1">
<part id="P1">
  <measure number="9">
    <attributes><divisions>1</divisions></attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type>
      <notations><slur type="start" number="1"/></notations>
    </note>
    <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type>
      <notations><slur type="stop" number="1"/></notations>
    </note>
  </measure>
  <measure number="10">
    <attributes><divisions>1</divisions></attributes>
    <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type>
      <notations><slur type="stop" number="9"/></notations>
    </note>
    <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
  </measure>
</part>
</score-partwise>"""
)

assert apply_fix(
    root,
    "",
    {
        "kind": "addSlur",
        "partId": "P1",
        "measureMxl": "9",
        "toMeasureMxl": "10",
        "fromNoteIndex": 0,
        "toNoteIndex": 1,
        "placement": "above",
    },
)

m9 = root.find("./part/measure[@number='9']")
m10 = root.find("./part/measure[@number='10']")
notes9 = list(m9.findall("{*}note"))
notes10 = list(m10.findall("{*}note"))

assert ("start", "1") in slurs_on(notes9[0]) or any(t == "start" for t, _ in slurs_on(notes9[0])), slurs_on(
    notes9[0]
)
# mid OMR short slur in m9 cleared
assert not slurs_on(notes9[1]), slurs_on(notes9[1])
assert not slurs_on(notes9[2]), slurs_on(notes9[2])
# orphan stop before end cleared; stop on chosen end note
assert not any(t == "stop" for t, _ in slurs_on(notes10[0])), slurs_on(notes10[0])
stops = [n for t, n in slurs_on(notes10[1]) if t == "stop"]
starts = [n for t, n in slurs_on(notes9[0]) if t == "start"]
assert starts and stops and starts[0] == stops[0], (slurs_on(notes9[0]), slurs_on(notes10[1]))
assert all(s.get("placement") == "above" for s in root.findall(".//{*}slur")), [
    s.attrib for s in root.findall(".//{*}slur")
]

normalize_slurs_in_root(root)
starts2 = [n for t, n in slurs_on(notes9[0]) if t == "start"]
stops2 = [n for t, n in slurs_on(notes10[1]) if t == "stop"]
assert starts2 and stops2 and starts2[0] == stops2[0], (slurs_on(notes9[0]), slurs_on(notes10[1]))

# same-measure still works
root2 = ET.fromstring(
    """<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>1</divisions></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
</measure></part></score-partwise>"""
)
assert apply_fix(
    root2,
    "",
    {
        "kind": "addSlur",
        "partId": "P1",
        "measureMxl": "1",
        "fromNoteIndex": 0,
        "toNoteIndex": 1,
        "placement": "below",
    },
)
assert len(root2.findall(".//{*}slur")) == 2

print("OK cross-measure slur HITL")
