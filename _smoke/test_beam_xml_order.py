import io
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fix, load_mxl_root  # noqa: E402

xml = """<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note>
  <pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type>
  <notations><tied type="stop"/></notations>
  <stem>down</stem><staff>1</staff>
</note>
<note>
  <pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type>
  <stem>down</stem><staff>1</staff>
</note>
</measure></part></score-partwise>"""
root = ET.fromstring(xml)
ok = apply_fix(
    root,
    "",
    {
        "kind": "applyBeam",
        "partId": "P1",
        "measureMxl": "1",
        "fromNoteIndex": 0,
        "toNoteIndex": 1,
    },
)
print("apply_fix", ok)

def note_child_order(note: ET.Element) -> list[str]:
    return [c.tag.split("}")[-1] if "}" in c.tag else c.tag for c in note]


for i, note in enumerate(root.findall(".//{*}note")):
    order = note_child_order(note)
    print(i, order)
    print(ET.tostring(note, encoding="unicode")[:400])
    if "beam" in order and "notations" in order:
        bi, ni = order.index("beam"), order.index("notations")
        if bi > ni:
            print("  *** BEAM AFTER NOTATIONS ***")
        else:
            print("  ok beam before notations")
