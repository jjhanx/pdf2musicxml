#!/usr/bin/env python3
import io
import json
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from inject_ocr import mxl_ns_uri, qname

items = json.loads((ROOT / "review_backup_남촌 D프렛.pdf.json").read_text(encoding="utf-8"))["items"]
mxl = ROOT / "남촌 D프렛.mxl"
if not mxl.exists():
    print("skip: no 남촌 D프렛.mxl")
    raise SystemExit(0)

tmp = Path(tempfile.mkdtemp())
src = tmp / "r.json"
src.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
subprocess.run(
    [sys.executable, str(ROOT / "scripts/inject_ocr.py"), str(mxl), str(tmp / "out.mxl"), str(src)],
    check=True,
)
with zipfile.ZipFile(tmp / "out.mxl") as z:
    c = z.read("META-INF/container.xml").decode()
    rf = re.search(r'full-path="([^"]+)"', c).group(1)
    data = z.read(rf)
root = ET.parse(io.BytesIO(data)).getroot()
ns = mxl_ns_uri(root)
part = root.findall(qname(ns, "part"))[0]
print("=== P1 v1 m7-11 ===")
for meas in part.findall(qname(ns, "measure")):
    m = meas.get("number")
    if m not in tuple(str(i) for i in range(7, 12)):
        continue
    row = []
    for note in meas.findall(qname(ns, "note")):
        if note.find(qname(ns, "rest")) is not None or note.find(qname(ns, "grace")) is not None:
            continue
        t = ""
        for L in note.findall(qname(ns, "lyric")):
            if L.get("number") in (None, "1"):
                te = L.find(qname(ns, "text"))
                if te is not None and te.text:
                    t += te.text
        row.append(t or ".")
    print(" m%s: %s" % (m, " | ".join(row)))
