import io
import os
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

sys.path.insert(0, "scripts")
from fix_audiveris_mxl import fix_mxl_path_inplace  # noqa: E402
from omr_hitl_lib import apply_fix, load_mxl_root, measure_snapshot  # noqa: E402

xml = """<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note>
  <pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><stem>down</stem>
  <notations><tied type="stop"/></notations>
</note>
<note>
  <chord/><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><stem>down</stem>
  <notations><tied type="stop"/></notations>
</note>
<note>
  <pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><stem>down</stem>
</note>
<note>
  <chord/><pitch><step>B</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><stem>down</stem>
</note>
<note>
  <pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><stem>down</stem>
</note>
<note>
  <pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><stem>down</stem>
</note>
</measure></part></score-partwise>"""
root = ET.fromstring(xml)
assert apply_fix(
    root,
    "",
    {
        "kind": "applyBeam",
        "partId": "P1",
        "measureMxl": "1",
        "fromNoteIndex": 0,
        "toNoteIndex": 2,
    },
)


def write_mxl(r: ET.Element, path: Path) -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>',
        )
        z.writestr("score.xml", ET.tostring(r, encoding="unicode"))
    path.write_bytes(buf.getvalue())


fd, name = tempfile.mkstemp(suffix=".mxl")
os.close(fd)
tmp = Path(name)
write_mxl(root, tmp)
snap1 = measure_snapshot(root, "", "P1", "1")
print("after applyBeam", [(n["index"], n.get("beams")) for n in snap1["elements"] if n["elementKind"] == "note"])
notes_xml = root.findall(".//{*}note")
for i, n in enumerate(notes_xml):
    has_chord = n.find("{*}chord") is not None or n.find("chord") is not None
    beams = n.findall("{*}beam") or n.findall("beam")
    if has_chord and beams:
        raise SystemExit(f"chord note {i} must not have beam tags")
print("chord members have no beam tags: ok")

fix_mxl_path_inplace(tmp)
_, _, root2 = load_mxl_root(tmp)
snap2 = measure_snapshot(root2, "", "P1", "1")
print("after fix_audiveris", [(n["index"], n.get("beams")) for n in snap2["elements"] if n["elementKind"] == "note"])

# simulate rebuild: apply fix again on post-fixed file
assert apply_fix(
    root2,
    "",
    {
        "kind": "applyBeam",
        "partId": "P1",
        "measureMxl": "1",
        "fromNoteIndex": 0,
        "toNoteIndex": 2,
    },
)
snap3 = measure_snapshot(root2, "", "P1", "1")
print("re-apply applyBeam", [(n["index"], n.get("beams")) for n in snap3["elements"] if n["elementKind"] == "note"])
tmp.unlink(missing_ok=True)
