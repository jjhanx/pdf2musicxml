import xml.etree.ElementTree as ET

import sys

sys.path.insert(0, "scripts")

from omr_hitl_lib import apply_fixes_to_root  # noqa: E402


XML = """<score-partwise version="3.1">
  <part-list><score-part id="P5"><part-name>Piano</part-name></score-part></part-list>
  <part id="P5">
    <measure number="58">
      <attributes>
        <divisions>1</divisions>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>2</staff></note>
    </measure>
    <measure number="59">
      <attributes>
        <divisions>1</divisions>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <attributes>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>"""


def staff2_start_clefs(measure: ET.Element) -> list[str]:
    out: list[str] = []
    for child in measure:
        if child.tag == "note" and child.findtext("staff") == "2":
            break
        if child.tag != "attributes":
            continue
        for clef in child.findall("clef"):
            if clef.get("number") == "2":
                out.append(f"{clef.findtext('sign')}{clef.findtext('line')}")
    return out


def staff2_pitch(measure: ET.Element) -> str:
    for note in measure.findall("note"):
        if note.findtext("staff") != "2":
            continue
        return f"{note.findtext('pitch/step')}{note.findtext('pitch/octave')}"
    raise AssertionError("missing staff 2 note")


def trailing_clefs_after_notes(measure: ET.Element) -> list[str]:
    out: list[str] = []
    seen_note = False
    for child in measure:
        if child.tag == "note":
            seen_note = True
            continue
        if not seen_note or child.tag != "attributes":
            continue
        for clef in child.findall("clef"):
            out.append(f"{clef.get('number')}:{clef.findtext('sign')}{clef.findtext('line')}")
    return out


root = ET.fromstring(XML)
m58 = root.find(".//measure[@number='58']")
m59 = root.find(".//measure[@number='59']")
assert m58 is not None and m59 is not None
before_pitch = staff2_pitch(m59)

stats = apply_fixes_to_root(
    root,
    [
        {
            "kind": "insertClef",
            "partId": "P5",
            "measureMxl": "59",
            "afterNoteIndex": -1,
            "staff": 2,
            "clefSign": "G",
            "clefLine": 2,
            "remapStaffPitches": True,
        }
    ],
)

assert stats["applied"] == 1, stats
assert trailing_clefs_after_notes(m58) == [], trailing_clefs_after_notes(m58)
assert staff2_start_clefs(m59) == ["G2"], staff2_start_clefs(m59)
assert staff2_pitch(m59) != before_pitch, (before_pitch, staff2_pitch(m59))

root2 = ET.fromstring(XML)
m58b = root2.find(".//measure[@number='58']")
m59b = root2.find(".//measure[@number='59']")
assert m58b is not None and m59b is not None
before_pitch_b = staff2_pitch(m59b)
stats2 = apply_fixes_to_root(
    root2,
    [
        {
            "kind": "setMeasureClef",
            "partId": "P5",
            "measureMxl": "59",
            "staff": 2,
            "clefSign": "G",
            "clefLine": 2,
            "remapStaffPitches": True,
        }
    ],
)
assert stats2["applied"] == 1, stats2
assert trailing_clefs_after_notes(m58b) == [], trailing_clefs_after_notes(m58b)
assert staff2_start_clefs(m59b) == ["G2"], staff2_start_clefs(m59b)
assert staff2_pitch(m59b) != before_pitch_b, (before_pitch_b, staff2_pitch(m59b))
print("ok insert clef at measure start stays in current measure")
