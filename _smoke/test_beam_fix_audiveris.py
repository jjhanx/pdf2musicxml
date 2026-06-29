import io
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
<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><stem>down</stem></note>
<note><chord/><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><type>eighth</type><stem>down</stem></note>
<note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><stem>down</stem></note>
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
snap1 = measure_snapshot(root, "", "P1", "1")
beams1 = [n.get("beams") for n in snap1["elements"] if n.get("elementKind") == "note"]
print("before fix_audiveris", beams1)

fd, name = tempfile.mkstemp(suffix=".mxl")
import os

os.close(fd)
tmp = Path(name)
buf = io.BytesIO()
with zipfile.ZipFile(buf, "w") as z:
    z.writestr(
        "META-INF/container.xml",
        '<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>',
    )
    z.writestr("score.xml", ET.tostring(root, encoding="unicode"))
tmp.write_bytes(buf.getvalue())
fix_mxl_path_inplace(tmp)
_, _, root2 = load_mxl_root(tmp)
snap2 = measure_snapshot(root2, "", "P1", "1")
beams2 = [n.get("beams") for n in snap2["elements"] if n.get("elementKind") == "note"]
print("after fix_audiveris", beams2)
tmp.unlink(missing_ok=True)
assert beams1 == beams2, f"beams changed: {beams1} -> {beams2}"
print("ok")
