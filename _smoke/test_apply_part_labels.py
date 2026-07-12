import json
import subprocess
import tempfile
import zipfile
from pathlib import Path

# Audiveris: part-name 안에 display-text만 있는 경우
xml = """<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1">
      <part-name><display-text>Voice</display-text></part-name>
      <score-instrument id="P1-I1"><instrument-name>Voice</instrument-name></score-instrument>
      <midi-instrument id="P1-I1"><midi-name>Voice</midi-name></midi-instrument>
    </score-part>
    <score-part id="P2">
      <part-name><display-text>Voice</display-text></part-name>
    </score-part>
    <score-part id="P3">
      <part-name><display-text>Voice</display-text></part-name>
    </score-part>
    <score-part id="P4">
      <part-name><display-text>Voice</display-text></part-name>
    </score-part>
    <score-part id="P5">
      <part-name>Piano</part-name>
    </score-part>
    <score-part id="P6">
      <part-name>Piano</part-name>
    </score-part>
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
print("exit", r.returncode, r.stdout.strip())
assert r.returncode == 0, r.stderr
with zipfile.ZipFile(mxl) as z:
    out = z.read("score.xml").decode()
assert "Voice" not in out, out
assert "<part-name>S</part-name>" in out
assert out.count("Piano") >= 2
print("OK: nested display-text Voice replaced; PR/PL -> Piano")

# P 라벨은 S/A/T/B처럼 그대로 (Piano/Pno.로 바꾸지 않음)
xml5 = """<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name><display-text>Voice</display-text></part-name></score-part>
    <score-part id="P2"><part-name><display-text>Voice</display-text></part-name></score-part>
    <score-part id="P3"><part-name><display-text>Voice</display-text></part-name></score-part>
    <score-part id="P4"><part-name><display-text>Voice</display-text></part-name></score-part>
    <score-part id="P5"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1"><measure number="1"/></part>
</score-partwise>"""
labels_p = td / "part_labels_p.json"
labels_p.write_text(
    json.dumps({"version": 1, "labelsByIndex": ["S", "A", "T", "B", "P"]}),
    encoding="utf-8",
)
mxl_p = td / "t_p.mxl"
with zipfile.ZipFile(mxl_p, "w") as z:
    z.writestr(
        "META-INF/container.xml",
        '<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>',
    )
    z.writestr("score.xml", xml5)
r2 = subprocess.run(
    ["python", "scripts/apply_part_labels.py", str(mxl_p), str(mxl_p), "--part-labels-json", str(labels_p)],
    capture_output=True,
    text=True,
    cwd=root,
)
assert r2.returncode == 0, r2.stderr
with zipfile.ZipFile(mxl_p) as z:
    out_p = z.read("score.xml").decode()
assert "<part-name>P</part-name>" in out_p, out_p
assert "Piano" not in out_p, out_p
assert "Pno" not in out_p, out_p
print("OK: P label stays P (not Piano/Pno.)")
