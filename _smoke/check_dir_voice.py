import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import apply_fix, apply_fixes_to_root, _ns

root = ET.fromstring(
    """<score-partwise version="3.1">
<part id="P5"><measure number="1">
<attributes><divisions>4</divisions></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><staff>1</staff></note>
<backup><duration>4</duration></backup>
<note><pitch><step>G</step><octave>2</octave></pitch><duration>4</duration><type>quarter</type><staff>2</staff><voice>5</voice></note>
</measure></part></score-partwise>"""
)
apply_fixes_to_root(
    root,
    [
        {
            "kind": "insertDirection",
            "partId": "P5",
            "measureMxl": "1",
            "afterNoteIndex": -1,
            "directionType": "words",
            "directionValue": "PL start",
            "staff": 2,
        }
    ],
)
d = root.find(".//{*}direction")
v = d.find("{*}voice")
print("voice after rebuild:", v.text if v is not None else None)
