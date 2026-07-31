"""Printed markers for 0ea5 session"""
import json
from pathlib import Path

manifest = json.loads(Path("청산에 살리라 F/_inspect_0ea5/lyric_manifest.json").read_text(encoding="utf-8"))

# inline minimal from printedMeasureNumbers
SIDEBAR_X_MAX = 130
DEFAULT_PAGE_WIDTH = 595

def classify_zone(bbox, page_width=DEFAULT_PAGE_WIDTH):
    x0, y0, x1, _ = bbox
    w = abs(x1 - x0)
    right_edge = page_width * 0.72
    if x0 >= right_edge and y0 < 110 and w <= 14:
        return "header"
    if x0 < SIDEBAR_X_MAX:
        return "sidebar_top" if y0 < 200 else "sidebar_bottom"
    return "other"

offset = 1
items = manifest.get("pymupdfReviewItems") or manifest.get("items") or []
candidates = []
for item in items:
    if item.get("type") not in ("measure_number", None):
        if item.get("type") != "measure_number":
            continue
    text = str(item.get("text") or "").strip()
    if not text.isdigit():
        continue
    bbox = item.get("bbox")
    if not bbox or len(bbox) < 4:
        continue
    zone = classify_zone(bbox)
    if zone == "header":
        continue
    printed = int(text)
    mxl = printed - offset + 1
    candidates.append((mxl, printed, zone, item.get("page")))

by_mxl = {}
for mxl, printed, zone, page in candidates:
    prev = by_mxl.get(mxl)
    if not prev or zone == "sidebar_bottom":
        by_mxl[mxl] = (printed, zone, page)

for mxl in range(24, 29):
    print(f"MXL {mxl} -> printed {by_mxl.get(mxl, ('?', '?', '?'))}")
