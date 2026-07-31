#!/usr/bin/env python3
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# inline TS logic mirror for marker parsing
MEASURE_NUM_RE = re.compile(r'^\d{1,3}$')

def strip_pua(text: str) -> str:
    return re.sub(r'[\uE000-\uF8FF]', '', text)

def is_measure_number_item(item: dict) -> bool:
    t = str(item.get('type') or '')
    if t == 'page_number':
        return False
    if t == 'measure_number':
        return True
    if t in ('title', 'composer', 'copyright', 'tempo'):
        return False
    text = strip_pua(str(item.get('text') or '')).strip()
    if not MEASURE_NUM_RE.match(text):
        return False
    bbox = item.get('bbox')
    if isinstance(bbox, list) and len(bbox) >= 4:
        w = abs(float(bbox[2]) - float(bbox[0]))
        if w > 100:
            return False
        if w <= 24:
            return True
    return t in ('', 'unknown')

def printed_sidebar_to_mxl(printed_num: int, offset: int) -> int:
    return printed_num - offset + 1

def parse_markers(manifest: dict, offset: int = 1) -> list[dict]:
    by_mxl: dict[int, str] = {}
    sources = []
    if isinstance(manifest.get('items'), list):
        sources.append(manifest['items'])
    if isinstance(manifest.get('pymupdfReviewItems'), list):
        sources.append(manifest['pymupdfReviewItems'])
    for coll in sources:
        for raw in coll:
            if not isinstance(raw, dict) or not is_measure_number_item(raw):
                continue
            printed = strip_pua(str(raw.get('text') or '')).strip()
            try:
                printed_num = int(printed)
            except ValueError:
                continue
            mxl = printed_sidebar_to_mxl(printed_num, offset)
            if mxl >= 1 and mxl not in by_mxl:
                by_mxl[mxl] = printed
    return [{'mxlMeasure': k, 'printedLabel': v} for k, v in sorted(by_mxl.items())]

for name in ['debug_omr/lyric_manifest.json', '_smoke/_6cbf_final/lyric_manifest.json']:
    p = ROOT / name
    if not p.exists():
        continue
    m = json.loads(p.read_text(encoding='utf-8'))
    raw_cnt = sum(1 for it in (m.get('items') or []) if isinstance(it, dict) and it.get('type') == 'measure_number')
    markers = parse_markers(m, 1)
    print(json.dumps({'file': name, 'raw_measure_number_items': raw_cnt, 'parsed_markers': len(markers), 'sample': markers[:10]}, ensure_ascii=False))
