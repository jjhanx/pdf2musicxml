#!/usr/bin/env python3
import io, json, re, subprocess, sys, tempfile, zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from inject_ocr import load_ocr_items, mxl_ns_uri, qname

ZIP = ROOT / "omr-work-82157d8d.zip"


def dump(root, ns, pi, m_range):
    part = root.findall(qname(ns, "part"))[pi - 1]
    lines = [f"=== P{pi} ==="]
    for meas in part.findall(qname(ns, "measure")):
        m = meas.get("number")
        if m not in m_range:
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


def run_inject(json_path, label):
    tmp = Path(tempfile.mkdtemp())
    with zipfile.ZipFile(ZIP) as z:
        z.extract("review.mxl", tmp)
        if json_path.suffix == ".zip":
            pass
    src = tmp / "r.json"
    if json_path.name.endswith(".zip"):
        import zipfile as zf

        with zf.ZipFile(ZIP) as z:
            data = json.loads(z.read("ocr_data_pymupdf.json").decode())
    else:
        data = json.loads(json_path.read_text(encoding="utf-8"))["items"]
    src.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    subprocess.run(
        [sys.executable, str(ROOT / "scripts/inject_ocr.py"), str(tmp / "review.mxl"), str(tmp / "out.mxl"), str(src)],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    with zipfile.ZipFile(tmp / "out.mxl") as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        data = z.read(rf)
    root = ET.parse(io.BytesIO(data)).getroot()
    ns = mxl_ns_uri(root)
    m_range = tuple(str(i) for i in range(8, 16))
    out = [f"--- {label} ---"]
    for pi in (1, 2, 3, 4):
        out.extend(dump(root, ns, pi, m_range))
    return out


def main():
    lines = []
    lines.extend(run_inject(ROOT / "review_backup_남촌 D프렛.pdf.json", "review_backup"))
    with zipfile.ZipFile(ZIP) as z:
        ocr = json.loads(z.read("ocr_data_pymupdf.json").decode())
    tmp = Path(tempfile.mkdtemp())
    p = tmp / "ocr.json"
    p.write_text(json.dumps(ocr, ensure_ascii=False), encoding="utf-8")
    lines.extend(run_inject(p, "zip ocr_data_pymupdf"))
    Path("_smoke/inject_compare_utf8.txt").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
