import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fix

XML = """<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>S</part-name></score-part>
    <score-part id="P5"><part-name>P</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="62">
      <attributes><divisions>2</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><voice>1</voice></note>
    </measure>
  </part>
  <part id="P5">
    <measure number="62">
      <attributes><divisions>2</divisions><staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><staff>1</staff><voice>1</voice></note>
      <backup><duration>2</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><type>quarter</type><staff>2</staff><voice>5</voice></note>
    </measure>
  </part>
</score-partwise>
"""
root = ET.fromstring(XML)
print(
    "S",
    apply_fix(
        root,
        "",
        {
            "kind": "addNoteDirection",
            "partId": "P1",
            "measureMxl": "62",
            "noteIndex": 0,
            "directionType": "words",
            "directionValue": "ritard.",
            "placement": "above",
        },
    ),
)
print(
    "PL",
    apply_fix(
        root,
        "",
        {
            "kind": "addNoteDirection",
            "partId": "P5",
            "measureMxl": "62",
            "noteIndex": 1,
            "directionType": "words",
            "directionValue": "ritard.",
            "placement": "above",
        },
    ),
)
p5 = root.find(".//{*}part[@id='P5']/{*}measure")
print(ET.tostring(p5, encoding="unicode"))
Path("_smoke/_tmp_ritard_pl.xml").write_text(ET.tostring(root, encoding="unicode"), encoding="utf-8")
