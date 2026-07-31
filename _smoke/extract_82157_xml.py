#!/usr/bin/env python3
import io, re, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
z = zipfile.ZipFile(ROOT / "omr-work-82157d8d.zip")
print(z.read("part_labels.json").decode()[:800])
with zipfile.ZipFile(io.BytesIO(z.read("review.mxl"))) as m:
    c = m.read("META-INF/container.xml").decode()
    rf = re.search(r'full-path="([^"]+)"', c).group(1)
    xml = m.read(rf).decode("utf-8")
out = ROOT / "_smoke/diag_82157_score.xml"
out.write_text(xml, encoding="utf-8")
print("wrote", out, "len", len(xml))
print("score-parts", xml.count("<score-part"))
