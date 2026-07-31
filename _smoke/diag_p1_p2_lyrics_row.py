#!/usr/bin/env python3
import io, json, re, shutil, subprocess, sys, tempfile, zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from inject_ocr import load_ocr_items, mxl_ns_uri, qname

tmp = Path(tempfile.mkdtemp())
items = json.loads((ROOT / "review_backup_남촌 D프렛.pdf.json").read_text(encoding="utf-8"))["items"]
src = tmp / "r.json"
src.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
with zipfile.ZipFile(ROOT / "omr-work-f7b18c9d.zip") as z:
    z.extract("review.mxl", tmp)
subprocess.run(
    [sys.executable, str(ROOT / "scripts/inject_ocr.py"), str(tmp / "review.mxl"), str(tmp / "out.mxl"), str(src)],
    check=True,
)
with zipfile.ZipFile(tmp / "out.mxl") as z:
    c = z.read("META-INF/container.xml").decode()
    rf = re.search(r'full-path="([^"]+)"', c).group(1)
    data = z.read(rf)
root = ET.parse(io.BytesIO(data)).getroot()
ns = mxl_ns_uri(root)

for pi in (1, 2):
    part = root.findall(qname(ns, "part"))[pi - 1]
    idx = 0
    print(f"=== P{pi} v1 ===")
    for meas in part.findall(qname(ns, "measure")):
        m = meas.get("number")
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
            idx += 1
        if m in tuple(str(i) for i in range(7, 14)):
            print(f" m{m}: {' | '.join(row)}")
