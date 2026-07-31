"""Verify splitGrandStaff preview: PL direction in P5__PL only, no staff=2 on direction."""
import sys
from pathlib import Path

# minimal inline check via ET after simulating what TS split does
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import apply_fixes_to_root, _local, _strip_all_direction_staff_tags, _ns, _q

minimal = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
<part-list>
<score-part id="P1"><part-name>P1</part-name></score-part>
<score-part id="P2"><part-name>P2</part-name></score-part>
<score-part id="P5"><part-name>Piano</part-name></score-part>
</part-list>
<part id="P1"><measure number="17"><attributes><divisions>4</divisions></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
</measure></part>
<part id="P2"><measure number="17"><attributes><divisions>4</divisions></attributes>
<note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
</measure></part>
<part id="P5"><measure number="17">
<attributes><divisions>4</divisions><staves>2</staves></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><staff>1</staff></note>
<backup><duration>4</duration></backup>
<note><pitch><step>G</step><octave>2</octave></pitch><duration>4</duration><type>quarter</type><staff>2</staff><voice>5</voice></note>
</measure></part>
</score-partwise>"""

root = ET.fromstring(minimal)
apply_fixes_to_root(
    root,
    [
        {
            "kind": "setNoteDirection",
            "partId": "P5",
            "measureMxl": "17",
            "noteIndex": 1,
            "directionType": "words",
            "directionValue": "PL TEST",
        }
    ],
)
ns = _ns(root)
_strip_all_direction_staff_tags(root, ns)
p2 = root.find('.//{*}part[@id="P2"]')
assert p2 is not None
assert not list(p2.iterfind('.//{*}direction')), "P2 must have no direction"
p5 = root.find('.//{*}part[@id="P5"]')
m = p5.find('{*}measure')
dirs = [c for c in m if _local(c) == 'direction']
assert len(dirs) == 1 and dirs[0].find('{*}staff') is None
print("server XML ok: direction in P5 only, no staff tag")
