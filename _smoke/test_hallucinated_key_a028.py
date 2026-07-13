"""omr-work-a028: m17 4-sharp key change preserved."""
import io
import json
import os
import sys
import subprocess
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

xml = """<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name><display-text>Voice</display-text></part-name></score-part>
    <score-part id="P2"><part-name><display-text>Voice</display-text></part-name></score-part>
    <score-part id="P3"><part-name><display-text>Voice</display-text></part-name></score-part>
    <score-part id="P4"><part-name><display-text>Voice</display-text></part-name></score-part>
    <score-part id="P5"><part-name>Piano</part-name></score-part>
    <score-part id="P6"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1"><measure number="1"/></part>
</score-partwise>"""

td = Path(tempfile.mkdtemp())
mxl = td / "t.mxl"
labels = td / "part_labels_preset.json"
labels.write_text(
    json.dumps({"version": 1, "labelsByIndex": ["S", "A", "T", "B", "PR", "PL"]}),
    encoding="utf-8",
)
with zipfile.ZipFile(mxl, "w") as z:
    z.writestr(
        "META-INF/container.xml",
        '<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>',
    )
    z.writestr("score.xml", xml)

root = Path(__file__).resolve().parents[1]
r = subprocess.run(
    ["python", "scripts/apply_part_labels.py", str(mxl), str(mxl)],
    capture_output=True,
    text=True,
    cwd=root,
)
assert r.returncode == 0, r.stderr
print("OK: PR/PL -> Piano")

ZIP = root / "omr-work-a028c3b5.zip"
if ZIP.is_file():
    sys.path.insert(0, str(root / "scripts"))
    os.environ["AUDIVERIS_MXL_RHYTHM_FIX"] = "off"
    from fix_audiveris_mxl import fix_mxl_file  # noqa: E402

    raw = td / "raw.mxl"
    fixed = td / "fixed.mxl"
    with zipfile.ZipFile(ZIP) as z:
        raw.write_bytes(z.read("audiveris_raw.mxl"))
    stats = fix_mxl_file(raw, fixed)
    with zipfile.ZipFile(fixed) as z:
        out = z.read([n for n in z.namelist() if n.endswith(".xml") and "META" not in n.upper()][0])

    def local(t):
        return t.split("}")[-1]

    root_el = ET.fromstring(out)
    fifths = []
    for el in root_el.iter():
        if local(el.tag) == "key":
            f = next((c for c in el if local(c.tag) == "fifths"), None)
            if f is not None and f.text:
                fifths.append(int(f.text))
    c = Counter(fifths)
    assert c == Counter({4: 4}), c
    assert stats.get("line_header_key_removed", 0) == 37, stats
    print("OK: a028 keeps m17 4-sharp; removes fake 1-sharp")
