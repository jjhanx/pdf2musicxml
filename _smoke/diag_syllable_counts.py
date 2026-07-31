#!/usr/bin/env python3
import io, json, re, sys, zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from inject_ocr import (
    attachable_notes_by_measure,
    build_events_for_items,
    collect_lyric_streams,
    mxl_ns_uri,
    qname,
    simulate_lyric_placements,
)

items = json.loads((ROOT / "review_backup_남촌 D프렛.pdf.json").read_text(encoding="utf-8"))["items"]
streams = collect_lyric_streams(items)

with zipfile.ZipFile(ROOT / "omr-work-82157d8d.zip") as z:
    data = z.read("review.mxl")

try:
    with zipfile.ZipFile(io.BytesIO(data)) as z2:
        c = z2.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        root = ET.parse(io.BytesIO(z2.read(rf))).getroot()
except Exception:
    root = ET.parse(io.BytesIO(data)).getroot()

ns = mxl_ns_uri(root)
parts = root.findall(qname(ns, "part"))

ref_ev = build_events_for_items(streams[1][0]["items"], parts[0], ns)
ref_pl = simulate_lyric_placements(ref_ev, parts[0], ns)
ref_by = {}
for m, _ in ref_pl:
    ref_by[m] = ref_by.get(m, 0) + 1

lines = ["P1 ref measure syllable counts:"]
for m in sorted(ref_by, key=lambda x: int(x)):
    if 8 <= int(m) <= 20:
        notes = len(attachable_notes_by_measure(parts[0], ns).get(m, []))
        lines.append(f"  m{m}: syllables={ref_by[m]} notes={notes}")

for pi in (1, 2, 3, 4):
    sl = [s for s in streams[pi] if s["verse"] == 1][0]
    ev = build_events_for_items(sl["items"], parts[pi - 1], ns)
    syll = [e for e in ev if e["op"] in ("syllable", "empty_note")]
    lines.append(f"P{pi}: {len(syll)} total syllables, blocks={len(sl['items'])}")

(ROOT / "_smoke/syllable_counts.txt").write_text("\n".join(lines), encoding="utf-8")
