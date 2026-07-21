#!/usr/bin/env python3
"""lyric_manifest 인쇄 마디 번호 → MusicXML measure@number (merge_lyric_sources 규칙 공유)."""
from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from measure_number_text import normalize_printed_measure_number_text

_MEASURE_NUM_RE = re.compile(r"^\d{1,3}$")
_PUA_RE = re.compile(
    r"[\uE000-\uF8FF\U000F0000-\U000FFFFF\U00100000-\U0010FFFF]"
)
_DEFAULT_PAGE_WIDTH_PT = 595.0


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


def _item_key(item: dict) -> str:
    iid = str(item.get("id") or item.get("matchId") or "")
    if iid:
        return iid
    bb = _bbox_of(item)
    pg = _item_page(item)
    label = normalize_printed_measure_number_text(str(item.get("text") or ""))
    if not label:
        label = _strip_pua(str(item.get("text") or "")).strip()
    if not bb:
        return f"p{pg}:{label}"
    return "p" + str(pg) + ":" + label + ":" + ",".join(str(round(v)) for v in bb)


def classify_measure_number_zone(
    bbox: list[float],
    page_width_pt: float = _DEFAULT_PAGE_WIDTH_PT,
) -> str:
    x0, y0, x1 = bbox[0], bbox[1], bbox[2]
    w = abs(x1 - x0)
    right_edge = page_width_pt * 0.72
    if x0 >= right_edge and y0 < 110 and w <= 14:
        return "header"
    if x0 < 130:
        return "sidebar_top" if y0 < 200 else "sidebar_bottom"
    return "other"


def is_measure_number_item(item: dict) -> bool:
    t = str(item.get("type") or "")
    if t == "page_number":
        return False
    if t in ("title", "composer", "copyright", "tempo"):
        return False

    normalized = normalize_printed_measure_number_text(str(item.get("text") or ""))
    if normalized and _MEASURE_NUM_RE.fullmatch(normalized):
        if t == "measure_number":
            return True
        bbox = _bbox_of(item)
        if bbox:
            w = abs(bbox[2] - bbox[0])
            if w > 100:
                return False
            if w <= 24:
                return True
        return t in ("", "unknown")

    if t == "measure_number":
        fallback = _strip_pua(str(item.get("text") or "")).strip()
        return bool(_MEASURE_NUM_RE.fullmatch(fallback))
    return False


def _zone_priority(zone: str) -> int:
    return {"sidebar_bottom": 3, "sidebar_top": 2, "header": 1}.get(zone, 0)


def manifest_uses_header_opening_measure_numbers(candidates: list[dict[str, Any]]) -> bool:
    return any(
        c.get("zone") == "header" and 2 <= int(c["printed"]) <= 11 for c in candidates
    )


def should_keep_measure_number_candidate(c: dict[str, Any], has_header_opening: bool) -> bool:
    printed = int(c["printed"])
    zone = str(c["zone"])
    if not has_header_opening:
        if zone in ("sidebar_top", "sidebar_bottom"):
            return printed >= 2
        if zone == "header":
            return 2 <= printed <= 11
        return bool(c.get("typed")) and float(c.get("bboxWidth") or 0) >= 10 and printed >= 2

    if zone == "header":
        return 2 <= printed <= 11
    if zone == "sidebar_bottom":
        return printed >= 17
    if zone == "sidebar_top":
        if printed <= 11:
            return False
        if printed >= 30:
            if printed < 50 and printed % 10 == 4:
                return False
            return True
        return False
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
            if not isinstance(item, dict) or not is_measure_number_item(item):
                continue
            key = _item_key(item)
            if key in seen:
                continue
            seen.add(key)

            label = normalize_printed_measure_number_text(str(item.get("text") or ""))
            if not label:
                label = _strip_pua(str(item.get("text") or "")).strip()
            if not _MEASURE_NUM_RE.fullmatch(label):
                continue

            printed = int(label)
            bbox = _bbox_of(item)
            if not bbox:
                continue
            w = abs(bbox[2] - bbox[0])
            zone = classify_measure_number_zone(bbox, page_width)
            typed = str(item.get("type") or "") == "measure_number"
            out.append(
                {
                    "page": _item_page(item),
                    "printed": printed,
                    "printedLabel": label,
                    "zone": zone,
                    "bboxWidth": w,
                    "typed": typed,
                    "itemKey": key,
                }
            )
    return out


def _candidate_score(c: dict[str, Any]) -> float:
    return _zone_priority(str(c["zone"])) * 1000 + float(c["bboxWidth"]) + (50 if c.get("typed") else 0)


def select_printed_measure_markers_from_candidates(
    candidates: list[dict[str, Any]],
    measure_offset: int = 1,
) -> list[tuple[int, str]]:
    has_header = manifest_uses_header_opening_measure_numbers(candidates)
    header_pages = [int(c["page"]) for c in candidates if c.get("zone") == "header"]
    min_header_page = min(header_pages) if has_header and header_pages else 0

    def _keep(c: dict[str, Any]) -> bool:
        if has_header and c.get("zone") != "header" and int(c["page"]) < min_header_page:
            return False
        return should_keep_measure_number_candidate(c, has_header)

    kept = [c for c in candidates if _keep(c)]
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
