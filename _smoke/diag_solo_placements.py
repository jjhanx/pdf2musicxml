#!/usr/bin/env python3
import io, json, re, subprocess, tempfile, zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
sys_path = ROOT / "scripts"
import sys

sys.path.insert(0, str(sys_path))
from inject_ocr import (
    build_events_for_items,
    collect_lyric_streams,
    mxl_ns_uri,
    qname,
    simulate_lyric_placements,
)

ZIP = ROOT / "omr-work-82157d8d.zip"
REVIEW = ROOT / "review_backup_남촌 D프렛.pdf.json"


def load_mxl_part():
    tmp = Path(tempfile.mkdtemp())
    with zipfile.ZipFile(ZIP) as z:
        z.extract("review.mxl", tmp)
    with zipfile.ZipFile(tmp / "review.mxl") as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        xml = z.read(rf)
    root = ET.parse(io.BytesIO(xml)).getroot()
    return root, mxl_ns_uri(root)


def verse1_items(items, pi):
    ly = [x for x in items if x.get("type") == "lyrics" and int(x.get("lyricPartIndex", 1) or 1) == pi]
    ly = [x for x in ly if int(x.get("lyricVerseIndex", 1) or 1) == 1]
    ly.sort(key=lambda x: (x.get("page", 1), x.get("y", 0), x.get("x", 0)))
    return ly


def placements_by_measure(part, ns, items):
    events = build_events_for_items(items, part, ns)
    pl = simulate_lyric_placements(events, part, ns)
    by_m = {}
    for m, ev in pl:
        t = ev.get("text") or ev.get("char") or ("-" if ev["op"] == "empty_note" else "")
        by_m.setdefault(m, []).append(t)
    return by_m


def main():
    items = json.loads(REVIEW.read_text(encoding="utf-8"))["items"]
    root, ns = load_mxl_part()
    parts = root.findall(qname(ns, "part"))
    lines = []
    for pi in (1, 2, 3, 4):
        v1 = verse1_items(items, pi)
        lines.append(f"P{pi} v1 blocks ({len(v1)}):")
        for i, x in enumerate(v1[:6]):
            lines.append(f"  {i}: {x.get('text', '')[:55]}")
        by_m = placements_by_measure(parts[pi - 1], ns, v1)
        for m in range(8, 16):
            ms = str(m)
            if ms in by_m:
                lines.append(f"  solo m{ms}: {by_m[ms]}")
    Path("_smoke/solo_placements.txt").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
