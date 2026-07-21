#!/usr/bin/env python3
"""lyric_manifest 인쇄 마디 번호 → MusicXML measure@number (merge_lyric_sources 규칙 공유)."""
from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from measure_number_text import (
    extract_leading_printed_measure_number_text,
    normalize_printed_measure_number_text,
)

_MEASURE_NUM_RE = re.compile(r"^\d{1,3}$")
_PUA_RE = re.compile(
    r"[\uE000-\uF8FF\U000F0000-\U000FFFFF\U00100000-\U0010FFFF]"
)
_DEFAULT_PAGE_WIDTH_PT = 595.0
_SIDEBAR_X_MAX_PT = 130.0


def _strip_pua(text: str) -> str:
    return _PUA_RE.sub("", text)


def _bbox_of(item: dict) -> list[float] | None:
    bbox = item.get("bbox")
    if not isinstance(bbox, list) or len(bbox) < 4:
        return None
    return [float(v) for v in bbox[:4]]


def _item_page(item: dict) -> int:
    p = item.get("page", item.get("pageIndex", 0))
    try:
        return int(p)
    except (TypeError, ValueError):
        return 0


def _item_key(item: dict, label: str) -> str:
    iid = str(item.get("id") or item.get("matchId") or "")
    if iid:
        return iid
    bb = _bbox_of(item)
    pg = _item_page(item)
    if not bb:
        return f"p{pg}:{label}"
    return "p" + str(pg) + ":" + label + ":" + ",".join(str(round(v)) for v in bb)


def _is_excluded_type(item: dict) -> bool:
    return str(item.get("type") or "") in (
        "page_number",
        "title",
        "composer",
        "copyright",
        "tempo",
    )


def classify_measure_number_zone(
    bbox: list[float],
    page_width_pt: float = _DEFAULT_PAGE_WIDTH_PT,
) -> str:
    x0, y0, x1 = bbox[0], bbox[1], bbox[2]
    w = abs(x1 - x0)
    right_edge = page_width_pt * 0.72
    if x0 >= right_edge and y0 < 110 and w <= 14:
        return "header"
    if x0 < _SIDEBAR_X_MAX_PT:
        return "sidebar_top" if y0 < 200 else "sidebar_bottom"
    return "other"


def is_sidebar_measure_number_bbox(bbox: list[float]) -> bool:
    return bbox[0] < _SIDEBAR_X_MAX_PT


def resolve_measure_number_from_manifest_item(
    item: dict,
    page_width_pt: float = _DEFAULT_PAGE_WIDTH_PT,
) -> tuple[str, list[float]] | None:
    if _is_excluded_type(item):
        return None

    spans = item.get("spans")
    if isinstance(spans, list) and spans:
        first = spans[0]
        if isinstance(first, dict):
            label = extract_leading_printed_measure_number_text(str(first.get("text") or ""))
            span_bbox = first.get("bbox")
            if (
                label
                and isinstance(span_bbox, list)
                and len(span_bbox) >= 4
            ):
                bb = [float(v) for v in span_bbox[:4]]
                if is_sidebar_measure_number_bbox(bb) and classify_measure_number_zone(bb, page_width_pt) != "header":
                    return label, bb

    bbox = _bbox_of(item)
    if not bbox:
        return None
    if classify_measure_number_zone(bbox, page_width_pt) == "header":
        return None

    raw = str(item.get("text") or "")
    leading = extract_leading_printed_measure_number_text(raw)
    pure = normalize_printed_measure_number_text(raw)
    stripped = _strip_pua(raw).strip()
    label = leading or (pure if pure and pure == stripped else None)
    if not label or not _MEASURE_NUM_RE.fullmatch(label):
        return None

    if is_sidebar_measure_number_bbox(bbox):
        return label, bbox

    w = abs(bbox[2] - bbox[0])
    t = str(item.get("type") or "")
    if w <= 24 and t in ("measure_number", "", "unknown"):
        return label, bbox
    return None


def is_measure_number_item(item: dict) -> bool:
    return resolve_measure_number_from_manifest_item(item) is not None


def should_keep_measure_number_candidate(c: dict[str, Any]) -> bool:
    zone = str(c["zone"])
    printed = int(c["printed"])
    if zone == "header":
        return False
    if zone in ("sidebar_top", "sidebar_bottom"):
        return printed >= 2
    return bool(c.get("typed")) and float(c.get("bboxWidth") or 0) >= 10 and printed >= 2


def collect_measure_number_candidates_from_manifest(
    manifest: dict | None,
) -> list[dict[str, Any]]:
    if not manifest:
        return []
    page_width = float(manifest.get("pageWidth") or _DEFAULT_PAGE_WIDTH_PT)
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    collections: list[list] = []
    items = manifest.get("items")
    if isinstance(items, list):
        collections.append(items)
    review = manifest.get("pymupdfReviewItems")
    if isinstance(review, list):
        collections.append(review)

    for coll in collections:
        for item in coll:
            if not isinstance(item, dict):
                continue
            resolved = resolve_measure_number_from_manifest_item(item, page_width)
            if not resolved:
                continue
            label, bbox = resolved
            key = _item_key(item, label)
            if key in seen:
                continue
            seen.add(key)

            w = abs(bbox[2] - bbox[0])
            zone = classify_measure_number_zone(bbox, page_width)
            typed = str(item.get("type") or "") == "measure_number"
            out.append(
                {
                    "page": _item_page(item),
                    "printed": int(label),
                    "printedLabel": label,
                    "zone": zone,
                    "bboxWidth": w,
                    "typed": typed,
                    "itemKey": key,
                }
            )
    return out


def _candidate_score(c: dict[str, Any]) -> float:
    zone = str(c["zone"])
    bonus = 10 if zone == "sidebar_bottom" else 0
    return (100 if c.get("typed") else 0) + float(c["bboxWidth"]) + bonus


def select_printed_measure_markers_from_candidates(
    candidates: list[dict[str, Any]],
    measure_offset: int = 1,
) -> list[tuple[int, str]]:
    kept = [c for c in candidates if should_keep_measure_number_candidate(c)]
    by_mxl: dict[int, dict[str, Any]] = {}
    for c in kept:
        mxl = printed_sidebar_number_to_mxl_measure(int(c["printed"]), measure_offset)
        if mxl < 1:
            continue
        prev = by_mxl.get(mxl)
        if prev is None or _candidate_score(c) > _candidate_score(prev):
            by_mxl[mxl] = c
    return sorted((mxl, str(c["printedLabel"])) for mxl, c in by_mxl.items())


def printed_sidebar_number_to_mxl_measure(printed_num: int, measure_offset: int = 1) -> int:
    """PDF 줄머리 measure_number → MusicXML measure@number (미리보기·MuseScore용 +1 보정)."""
    return printed_num - int(measure_offset) + 1


def load_printed_measure_marker_map(manifest_path: Path, measure_offset: int = 1) -> dict[int, str]:
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        return {}
    markers = select_printed_measure_markers_from_candidates(
        collect_measure_number_candidates_from_manifest(data),
        measure_offset,
    )
    return dict(markers)


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
    return set(load_printed_measure_marker_map(manifest_path, measure_offset).keys())
