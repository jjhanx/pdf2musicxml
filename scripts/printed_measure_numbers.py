#!/usr/bin/env python3
"""lyric_manifest 인쇄 마디 번호 → MusicXML measure@number (merge_lyric_sources 규칙 공유)."""
from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
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


def load_printed_measure_marker_map(manifest_path: Path, measure_offset: int = 1) -> dict[int, str]:
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        return {}
    collections: list[list] = []
    items = data.get("items")
    if isinstance(items, list):
        collections.append(items)
    review = data.get("pymupdfReviewItems")
    if isinstance(review, list):
        collections.append(review)
    out: dict[int, str] = {}
    for coll in collections:
        for item in coll:
            if not isinstance(item, dict) or not is_measure_number_item(item):
                continue
            printed = _strip_pua(str(item.get("text") or "")).strip()
            if not printed.isdigit():
                continue
            mxl = printed_sidebar_number_to_mxl_measure(int(printed), measure_offset)
            if mxl >= 1 and mxl not in out:
                out[mxl] = printed
    return out


def strip_spurious_measure_number_words_root(
    root: ET.Element,
    ns: str,
    allowed: dict[int, str] | None,
) -> int:
    """마디 `<direction><words>` 숫자(1–3자리) — manifest 인쇄 마디 외 제거."""

    def q(local: str) -> str:
        return f"{{{ns}}}{local}" if ns else local

    allowed = allowed or {}
    removed = 0
    measure_num_re = re.compile(r"^\d{1,3}$")
    for part in root.findall(q("part")):
        for measure in part.findall(q("measure")):
            mnum = int(measure.get("number") or 0)
            allowed_label = allowed.get(mnum)
            for direction in list(measure.findall(q("direction"))):
                if _direction_has_tempo(direction, ns):
                    continue
                words_text = _direction_words_text(direction, ns)
                if not words_text or not measure_num_re.fullmatch(words_text):
                    continue
                if allowed_label and words_text == allowed_label:
                    continue
                measure.remove(direction)
                removed += 1
    return removed


def _direction_has_tempo(direction: ET.Element, ns: str) -> bool:
    q = lambda local: f"{{{ns}}}{local}" if ns else local
    for dtype in direction.findall(q("direction-type")):
        if dtype.find(q("metronome")) is not None:
            return True
    return False


def _direction_words_text(direction: ET.Element, ns: str) -> str | None:
    q = lambda local: f"{{{ns}}}{local}" if ns else local
    for dtype in direction.findall(q("direction-type")):
        words = dtype.find(q("words"))
        if words is not None and words.text and words.text.strip():
            return words.text.strip()
    return None


def load_printed_measure_mxl_set(manifest_path: Path, measure_offset: int = 1) -> set[int]:
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        return set()
    collections: list[list] = []
    items = data.get("items")
    if isinstance(items, list):
        collections.append(items)
    review = data.get("pymupdfReviewItems")
    if isinstance(review, list):
        collections.append(review)
    out: set[int] = set()
    for coll in collections:
        for item in coll:
            if not isinstance(item, dict) or not is_measure_number_item(item):
                continue
            printed = _strip_pua(str(item.get("text") or "")).strip()
            if not printed.isdigit():
                continue
            mxl = printed_sidebar_number_to_mxl_measure(int(printed), measure_offset)
            if mxl >= 1:
                out.add(mxl)
    return out
