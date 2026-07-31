#!/usr/bin/env python3
import io, json, re, subprocess, sys, tempfile, zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from inject_ocr import (
    attachable_notes_by_measure,
    list_attachable_notes_in_measure,
    load_ocr_items,
    mxl_ns_uri,
    qname,
)

ZIP = ROOT / "omr-work-82157d8d.zip"
REVIEW = ROOT / "review_backup_남촌 D프렛.pdf.json"


def dump_part_lyrics(root, ns, pi, m_range):
    part = root.findall(qname(ns, "part"))[pi - 1]
    print(f"=== P{pi} v1 ===")
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
        print(f" m{m}: {' | '.join(row)} ({len(row)} notes)")


def count_notes(part, ns, m):
    for meas in part.findall(qname(ns, "measure")):
        if meas.get("number") == str(m):
            return len(list_attachable_notes_in_measure(meas, ns))
    return 0


def main():
    tmp = Path(tempfile.mkdtemp())
    items = json.loads(REVIEW.read_text(encoding="utf-8"))["items"]
    lyrics = [x for x in items if x.get("type") == "lyrics"]
    for pi in (1, 2, 3, 4):
        bl = [x for x in lyrics if int(x.get("lyricPartIndex", 1) or 1) == pi]
        print(f"review lyrics blocks P{pi}: {len(bl)}")
        for x in bl[:3]:
            print(f"  skip={x.get('lyricSkipNotes',0)!r} text={x.get('text','')[:60]!r}")
        if len(bl) > 3:
            print(f"  ... last: {bl[-1].get('text','')[:60]!r}")

    src = tmp / "r.json"
    src.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
    with zipfile.ZipFile(ZIP) as z:
        z.extract("review.mxl", tmp)
    subprocess.run(
        [sys.executable, str(ROOT / "scripts/inject_ocr.py"), str(tmp / "review.mxl"), str(tmp / "out.mxl"), str(src)],
        check=True,
        capture_output=True,
        text=True,
    )
    with zipfile.ZipFile(tmp / "out.mxl") as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        data = z.read(rf)
    root = ET.parse(io.BytesIO(data)).getroot()
    ns = mxl_ns_uri(root)
    parts = root.findall(qname(ns, "part"))
    m_range = tuple(str(i) for i in range(7, 16))
    for pi in (1, 2, 3, 4):
        dump_part_lyrics(root, ns, pi, m_range)
    print("--- note counts m9/m10 ---")
    for m in ("9", "10", "11"):
        row = [f"P{pi+1}={count_notes(parts[pi], ns, m)}" for pi in range(4)]
        print(f"m{m}: {' '.join(row)}")


if __name__ == "__main__":
    main()
