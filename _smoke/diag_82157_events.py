#!/usr/bin/env python3
import io, json, re, subprocess, sys, tempfile, zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from inject_ocr import (
    build_events_for_items,
    collect_lyric_streams,
    load_ocr_items,
    mxl_ns_uri,
    qname,
    simulate_lyric_placements,
)

ZIP = ROOT / "omr-work-82157d8d.zip"
REVIEW = ROOT / "review_backup_남촌 D프렛.pdf.json"


def main():
    out_lines = []
    def log(*a):
        out_lines.append(" ".join(str(x) for x in a))

    items = json.loads(REVIEW.read_text(encoding="utf-8"))["items"]
    streams = collect_lyric_streams(items)
    s1 = streams[1][0]  # part 1 verse 1
    print("P1 stream items:", len(s1["items"]))
    for i, it in enumerate(s1["items"][:8]):
        print(f"  [{i}] {it.get('text','')!r} skip={it.get('lyricSkipNotes',0)}")

    tmp = Path(tempfile.mkdtemp())
    with zipfile.ZipFile(ZIP) as z:
        z.extract("review.mxl", tmp)
    with zipfile.ZipFile(tmp / "review.mxl") as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        xml = z.read(rf)
    root = ET.parse(io.BytesIO(xml)).getroot()
    ns = mxl_ns_uri(root)
    p1 = root.findall(qname(ns, "part"))[0]
    events = build_events_for_items(s1["items"], p1, ns)
    syll = [e for e in events if e["op"] in ("syllable", "empty_note")]
    print("total events", len(events), "syllable/empty", len(syll))
    placements = simulate_lyric_placements(events, p1, ns)
    by_m = {}
    for m, ev in placements:
        t = ev.get("text") or ev.get("char") or ("-" if ev["op"] == "empty_note" else "?")
        by_m.setdefault(m, []).append(t)
    for m in sorted(by_m.keys(), key=lambda x: int(x) if x.isdigit() else 0):
        if int(m) if m.isdigit() else 0 > 16:
            break
        if int(m) if m.isdigit() else 0 >= 7:
            print(f"m{m}: {by_m[m]}")

    # P2 own stream vs shared
    if 2 in streams:
        s2 = streams[2][0]
        print("\nP2 stream items:", len(s2["items"]))
        for i, it in enumerate(s2["items"][:6]):
            print(f"  [{i}] {it.get('text','')!r}")
        p2 = root.findall(qname(ns, "part"))[1]
        ev2 = build_events_for_items(s2["items"], p2, ns)
        pl2 = simulate_lyric_placements(ev2, p2, ns)
        by2 = {}
        for m, ev in pl2:
            t = ev.get("text") or ev.get("char") or ("-" if ev["op"] == "empty_note" else "?")
            by2.setdefault(m, []).append(t)
        for m in ("8", "9", "10", "11", "12", "13"):
            print(f"P2 solo m{m}: {by2.get(m, [])}")


if __name__ == "__main__":
    main()
