#!/usr/bin/env python3
"""lyric_manifest 인쇄 마디 번호 → MusicXML measure@number (merge_lyric_sources 규칙 공유)."""
from __future__ import annotations

import json
import re
from pathlib import Path

_MEASURE_NUM_RE = re.compile(r"^\d{1,3}$")
_PUA_RE = re.compile(
    r"[\uE000-\uF8FF\U000F0000-\U000FFFFF\U00100000-\U0010FFFF]"
)


def _strip_pua(text: str) -> str:
    return _PUA_RE.sub("", text)


def is_measure_number_item(item: dict) -> bool:
    t = str(item.get("type") or "")
    if t == "page_number":
        return False
    if t == "measure_number":
        return True
    if t in ("title", "composer", "copyright", "tempo"):
        return False
    text = _strip_pua(str(item.get("text") or "")).strip()
    if not _MEASURE_NUM_RE.fullmatch(text):
        return False
    bbox = item.get("bbox")
    if isinstance(bbox, list) and len(bbox) >= 4:
        w = abs(float(bbox[2]) - float(bbox[0]))
        if w > 100:
            return False
        if w <= 24:
            return True
    return t in ("", "unknown")


def printed_sidebar_number_to_mxl_measure(printed_num: int, measure_offset: int = 1) -> int:
    """PDF 줄머리 measure_number → MusicXML measure@number (미리보기·MuseScore용 +1 보정)."""
    return printed_num - int(measure_offset) + 1


def load_printed_measure_mxl_set(manifest_path: Path, measure_offset: int = 1) -> set[int]:
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return set()
    out: set[int] = set()
    for item in items:
        if not isinstance(item, dict) or not is_measure_number_item(item):
            continue
        printed = _strip_pua(str(item.get("text") or "")).strip()
        if not printed.isdigit():
            continue
        mxl = printed_sidebar_number_to_mxl_measure(int(printed), measure_offset)
        if mxl >= 1:
            out.add(mxl)
    return out
