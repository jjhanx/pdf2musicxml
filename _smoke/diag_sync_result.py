#!/usr/bin/env python3
import io, json, re, subprocess, tempfile, zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
import sys

sys.path.insert(0, str(ROOT / "scripts"))
from inject_ocr import mxl_ns_uri, qname

ZIP = ROOT / "omr-work-82157d8d.zip"
REVIEW = ROOT / "review_backup_남촌 D프렛.pdf.json"


def inject_and_dump():
    tmp = Path(tempfile.mkdtemp())
    items = json.loads(REVIEW.read_text(encoding="utf-8"))["items"]
    (tmp / "r.json").write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
    with zipfile.ZipFile(ZIP) as z:
        z.extract("review.mxl", tmp)
    subprocess.run(
        [sys.executable, str(ROOT / "scripts/inject_ocr.py"), str(tmp / "review.mxl"), str(tmp / "out.mxl"), str(tmp / "r.json")],
        check=True,
    )
    with zipfile.ZipFile(tmp / "out.mxl") as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        root = ET.parse(io.BytesIO(z.read(rf))).getroot()
    ns = mxl_ns_uri(root)
    lines = []
    for pi in (1, 2, 3, 4):
        part = root.findall(qname(ns, "part"))[pi - 1]
        lines.append(f"=== P{pi} after sync ===")
        for meas in part.findall(qname(ns, "measure")):
            m = meas.get("number")
            if m not in {str(i) for i in range(8, 16)}:
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
            lines.append(f"m{m}: {' | '.join(row)}")
    return lines


if __name__ == "__main__":
    out = inject_and_dump()
    Path("_smoke/sync_result.txt").write_text("\n".join(out), encoding="utf-8")
