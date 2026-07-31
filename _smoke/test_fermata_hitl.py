import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fix, measure_snapshot  # noqa: E402

root = ET.fromstring("""<score-partwise version="3.1">
<part id="P5"><measure number="7">
<attributes><divisions>4</divisions></attributes>
<note><pitch><step>F</step><octave>3</octave></pitch><duration>1</duration><type>16th</type><stem>up</stem><staff>2</staff>
<notations><fermata type="upright"/></notations></note>
</measure></part></score-partwise>""")

assert apply_fix(root, "", {"kind": "removeFermata", "partId": "P5", "measureMxl": "7", "noteIndex": 0})
assert root.find(".//{*}fermata") is None

assert apply_fix(
    root,
    "",
    {"kind": "addFermata", "partId": "P5", "measureMxl": "7", "noteIndex": 0, "fermataType": "inverted"},
)
ferm = root.find(".//{*}fermata")
assert ferm is not None and ferm.get("type") == "inverted"
snap = measure_snapshot(root, "", "P5", "7")
assert snap["notes"][0]["fermatas"][0].startswith("inverted")

print("fermata hitl ok")
