import xml.etree.ElementTree as ET

import sys

sys.path.insert(0, "scripts")

from omr_hitl_lib import apply_fixes_to_root, measure_snapshot  # noqa: E402


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
        <clef number="2"><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <attributes>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>"""


def staff2_head_clefs(measure: ET.Element) -> list[str]:
    out: list[str] = []
    for child in measure:
        if child.tag == "note":
            break
        if child.tag != "attributes":
            continue
        for clef in child.findall("clef"):
            if clef.get("number") != "2":
                continue
            sign = clef.findtext("sign")
            line = clef.findtext("line")
            out.append(f"{sign}{line}")
    return out


def staff2_mid_clefs(measure: ET.Element) -> list[str]:
    out: list[str] = []
    seen_note = False
    for child in measure:
        if child.tag == "note":
            seen_note = True
            continue
        if not seen_note or child.tag != "attributes":
            continue
        for clef in child.findall("clef"):
            if clef.get("number") != "2":
                continue
            out.append(f"{clef.findtext('sign')}{clef.findtext('line')}")
    return out


root = ET.fromstring(XML)
snap = measure_snapshot(root, "", "P5", "58")
assert snap is not None
next_header = [
    e
    for e in snap["elements"]
    if e.get("elementKind") == "clef"
    and e.get("clefScope") == "nextHeader"
    and e.get("targetMeasureMxl") == "59"
    and e.get("staff") == 2
]
assert next_header, snap["elements"]
assert next_header[0].get("clefSign") == "G", next_header

stats = apply_fixes_to_root(
    root,
    [
        {
            "kind": "removeClef",
            "partId": "P5",
            "measureMxl": "59",
            "clefScope": "header",
            "clefIndex": next_header[0]["clefIndex"],
            "staff": 2,
        }
    ],
)
assert stats["applied"] == 1, stats
m59 = root.find(".//measure[@number='59']")
assert m59 is not None
assert staff2_head_clefs(m59) == [], staff2_head_clefs(m59)
assert staff2_mid_clefs(m59) == ["F4"], staff2_mid_clefs(m59)
print("ok next header courtesy clef delete")
