#!/usr/bin/env python3
"""pdfplumber 추출과 PyMuPDF 검토 결과를 MusicXML 주입용 manifest(v3)로 병합합니다."""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

MANIFEST_VERSION = 3
DEFAULT_MIN_LYRICS_SIZE = 7.0
DEFAULT_MAX_LYRICS_SIZE = 17.0
Y_TOLERANCE_PT = 4.0
IOU_MATCH_THRESHOLD = 0.25
_MEASURE_NUM_RE = re.compile(r"^\d{1,3}$")


def is_measure_number_item(item: dict[str, Any]) -> bool:
    """악보 좌측 마디 번호(14, 17 등) — 가사 주입 대상이 아님."""
    t = str(item.get("type") or "")
    if t == "page_number":
        return False
    if t == "measure_number":
        return True
    if t in ("title", "composer", "copyright", "tempo"):
        return False
    text = strip_pua(str(item.get("text") or "")).strip()
    if not _MEASURE_NUM_RE.fullmatch(text):
        return False
    bbox = item.get("bbox")
    if isinstance(bbox, list) and len(bbox) >= 4:
        w = abs(float(bbox[2]) - float(bbox[0]))
        if w > 100:
            return False
        # 좁은 bbox 숫자는 UI에서 lyrics로 잘못 태깅돼도 마디 번호로 본다.
        if w <= 24:
            return True
    return t in ("", "unknown")


def is_page_number_item(item: dict[str, Any]) -> bool:
    """악보 하단·상단 PDF 페이지 번호 — 가사 주입 대상이 아님."""
    return str(item.get("type") or "") == "page_number"


def resolve_inject_type(item: dict[str, Any]) -> str:
    """merge·flat 출력용 type — unknown 숫자는 measure_number, unknown 문자는 미분류 유지."""
    t = item.get("type")
    if t == "page_number":
        return "page_number"
    if t == "measure_number":
        return "measure_number"
    if is_measure_number_item(item):
        return "measure_number"
    if t == "unknown":
        return "unknown"
    if t in (None, ""):
        return "lyrics"
    return str(t)


def strip_pua(text: str) -> str:
    return re.sub(
        r"[\uE000-\uF8FF\U000F0000-\U000FFFFF\U00100000-\U0010FFFF]",
        "",
        text,
    )


def bbox_union(boxes: list[list[float]]) -> list[float]:
    xs0 = [b[0] for b in boxes]
    ys0 = [b[1] for b in boxes]
    xs1 = [b[2] for b in boxes]
    ys1 = [b[3] for b in boxes]
    return [min(xs0), min(ys0), max(xs1), max(ys1)]


def bbox_iou(a: list[float], b: list[float]) -> float:
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    ix0 = max(ax0, bx0)
    iy0 = max(ay0, by0)
    ix1 = min(ax1, bx1)
    iy1 = min(ay1, by1)
    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0
    inter = (ix1 - ix0) * (iy1 - iy0)
    area_a = max(0.0, (ax1 - ax0) * (ay1 - ay0))
    area_b = max(0.0, (bx1 - bx0) * (by1 - by0))
    denom = area_a + area_b - inter
    if denom <= 0:
        return 0.0
    return inter / denom


# 악보 읽기 순서 — A4 기본(pt). bbox 없을 때 x/y(300dpi)로 환산.
DEFAULT_PAGE_WIDTH_PT = 595.0
DEFAULT_PAGE_HEIGHT_PT = 842.0
_PDF_UI_ZOOM = 300.0 / 72.0
# 페이지 끝 오른쪽 픽업(예: m8 산) — 다음 페이지 상단 가사보다 뒤로 보냄
_PICKUP_X_FRAC = 0.72
_PICKUP_Y_FRAC = 0.52
_PAGE_HEAD_Y_FRAC = 0.22
_PICKUP_MAX_TEXT_LEN = 8


def _item_bbox_pts(item: dict[str, Any]) -> tuple[float, float, float, float]:
    bbox = item.get("bbox")
    if isinstance(bbox, list) and len(bbox) >= 4:
        return (
            float(bbox[0]),
            float(bbox[1]),
            float(bbox[2]),
            float(bbox[3]),
        )
    x = float(item.get("x", 0) or 0) / _PDF_UI_ZOOM
    y = float(item.get("y", 0) or 0) / _PDF_UI_ZOOM
    return x, y, x, y


def _is_page_end_pickup(
    item: dict[str, Any],
    *,
    page_width: float = DEFAULT_PAGE_WIDTH_PT,
    page_height: float = DEFAULT_PAGE_HEIGHT_PT,
) -> bool:
    """페이지 하단·오른쪽 짧은 픽업 음절(다음 페이지 상단 가사보다 뒤에 읽힘)."""
    x0, y0, x1, y1 = _item_bbox_pts(item)
    if x0 < page_width * _PICKUP_X_FRAC:
        return False
    if y0 < page_height * _PICKUP_Y_FRAC:
        return False
    text = strip_pua(str(item.get("text") or "")).strip()
    if not text:
        return False
    if len(text) > _PICKUP_MAX_TEXT_LEN:
        return False
    # 한 줄 전체 폭이 넓으면 가사 줄이지 픽업이 아님
    if (x1 - x0) > page_width * 0.35:
        return False
    return True


def _lyric_reading_wave(item: dict[str, Any]) -> int:
    """악보 읽기 파도 — 페이지 넘김 픽업을 다음 페이지 상단 가사 뒤에 둠."""
    page = int(item.get("page", 1) or 1)
    if page < 1:
        page = 1
    x0, y0, _, _ = _item_bbox_pts(item)
    if _is_page_end_pickup(item):
        return 4 * page - 2
    if page >= 2 and y0 < DEFAULT_PAGE_HEIGHT_PT * _PAGE_HEAD_Y_FRAC:
        return 4 * page - 7
    if page == 1:
        return 0
    return 4 * page - 5


def lyric_reading_sort_key(item: dict[str, Any]) -> tuple[float, float, float]:
    """가사 주입·검토 목록용 읽기 순서 (wave, y, x)."""
    wave = float(_lyric_reading_wave(item))
    x0, y0, _, _ = _item_bbox_pts(item)
    return wave, y0, x0


def sort_lyric_items_reading_order(items: list[dict[str, Any]]) -> None:
    items.sort(key=lyric_reading_sort_key)


def normalize_text(s: str) -> str:
    return re.sub(r"\s+", "", strip_pua(s or "")).lower()


def cluster_plumber_chars_to_lines(
    page_number: int,
    chars: list[dict[str, Any]],
    *,
    min_size: float,
    max_size: float,
) -> list[dict[str, Any]]:
    filtered = [
        c
        for c in chars
        if min_size <= float(c.get("size", 0)) <= max_size and str(c.get("raw_text", "")).strip()
    ]
    if not filtered:
        return []

    for c in filtered:
        c["_y_center"] = (float(c["y0"]) + float(c["y1"])) / 2.0
        c["_x0"] = float(c["x0"])

    filtered.sort(key=lambda c: (c["_y_center"], c["_x0"]))

    lines: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    for ch in filtered:
        if not current:
            current = [ch]
            continue
        avg_y = sum(x["_y_center"] for x in current) / len(current)
        if abs(ch["_y_center"] - avg_y) <= Y_TOLERANCE_PT:
            current.append(ch)
        else:
            lines.append(current)
            current = [ch]
    if current:
        lines.append(current)

    out: list[dict[str, Any]] = []
    item_idx = 0
    zoom = 300 / 72

    for line_chars in lines:
        line_chars.sort(key=lambda c: c["_x0"])
        merged = ""
        boxes: list[list[float]] = []
        sizes: list[float] = []
        fonts: list[str] = []

        for i, ch in enumerate(line_chars):
            if i > 0:
                prev = line_chars[i - 1]
                gap = float(ch["x0"]) - float(prev["x1"])
                if gap > 3:
                    merged += " "
            merged += str(ch.get("raw_text", ""))
            boxes.append([float(ch["x0"]), float(ch["y0"]), float(ch["x1"]), float(ch["y1"])])
            sizes.append(float(ch.get("size", 0)))
            fonts.append(str(ch.get("fontname", "Unknown")))

        merged = strip_pua(merged).strip()
        if not merged:
            continue

        bbox = bbox_union(boxes)
        x_center = (bbox[0] + bbox[2]) / 2
        y_center = (bbox[1] + bbox[3]) / 2
        avg_size = sum(sizes) / len(sizes) if sizes else 0.0
        fontname = max(set(fonts), key=fonts.count) if fonts else "Unknown"

        out.append(
            {
                "id": f"sep_p{page_number}_{item_idx}",
                "page": page_number,
                "text": merged,
                "confidence": 1.0,
                "x": float(x_center * zoom),
                "y": float(y_center * zoom),
                "bbox": bbox,
                "type": "unknown",
                "fontSize": round(avg_size, 2),
                "fontname": fontname,
                "provenance": "pdfplumber",
            }
        )
        item_idx += 1

    return out


def plumber_pages_to_items(
    pages: list[dict[str, Any]],
    *,
    min_size: float,
    max_size: float,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for page in pages:
        page_num = int(page.get("page_number", 1))
        chars = page.get("text_elements") or []
        if not isinstance(chars, list):
            continue
        items.extend(
            cluster_plumber_chars_to_lines(
                page_num,
                chars,
                min_size=min_size,
                max_size=max_size,
            )
        )
    return items


def is_meta_item(item: dict[str, Any]) -> bool:
    t = item.get("type", "")
    return isinstance(t, str) and t.startswith("_")


def partition_review_payload(rows: list[Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    items: list[dict[str, Any]] = []
    manual: list[dict[str, Any]] = []
    for raw in rows:
        if not isinstance(raw, dict):
            continue
        if raw.get("type") == "_manual_lyric_mask":
            zones = raw.get("manualRects") or []
            if isinstance(zones, list):
                manual.extend(z for z in zones if isinstance(z, dict))
            continue
        items.append(raw)
    return items, manual


def load_pymupdf_review(path: str | None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if not path:
        return [], []
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, dict) and data.get("v") in (2, 3) and isinstance(data.get("items"), list):
        manual = data.get("manualLyricRects") or []
        return [x for x in data["items"] if isinstance(x, dict)], [
            x for x in manual if isinstance(x, dict)
        ]
    if isinstance(data, list):
        return partition_review_payload(data)
    return [], []


def best_pymupdf_match(
    sep_item: dict[str, Any],
    pymupdf_items: list[dict[str, Any]],
    used_ids: set[str],
) -> dict[str, Any] | None:
    page = int(sep_item.get("page", 1))
    bbox = sep_item.get("bbox")
    if not isinstance(bbox, list) or len(bbox) < 4:
        return None
    sep_text = normalize_text(str(sep_item.get("text", "")))

    candidates = [
        it
        for it in pymupdf_items
        if not is_meta_item(it)
        and int(it.get("page", 1)) == page
        and str(it.get("id", "")) not in used_ids
    ]

    best: dict[str, Any] | None = None
    best_score = 0.0

    for it in candidates:
        ib = it.get("bbox")
        if not isinstance(ib, list) or len(ib) < 4:
            continue
        iou = bbox_iou(bbox, [float(x) for x in ib[:4]])
        text_sim = 0.0
        if sep_text:
            it_text = normalize_text(str(it.get("text", "")))
            if it_text and (sep_text in it_text or it_text in sep_text):
                text_sim = 0.35
            elif it_text == sep_text:
                text_sim = 0.5
        score = iou + text_sim
        if score > best_score:
            best_score = score
            best = it

    if best_score >= IOU_MATCH_THRESHOLD:
        return best
    return None


def merge_item(sep_item: dict[str, Any], pymupdf_item: dict[str, Any] | None) -> dict[str, Any]:
    merged = dict(sep_item)
    if pymupdf_item is None:
        merged["type"] = resolve_inject_type(merged)
        merged["provenance"] = "pdfplumber"
        return merged

    merged["provenance"] = "merged"
    merged["matchId"] = pymupdf_item.get("id")

    for key in (
        "type",
        "text",
        "lyricPartIndex",
        "lyricVerseIndex",
        "lyricVoice",
        "lyricSkipNotes",
        "bbox",
        "spans",
    ):
        if key in pymupdf_item and pymupdf_item[key] not in (None, ""):
            merged[key] = pymupdf_item[key]

    merged["type"] = resolve_inject_type(merged)

    if "fontSize" not in merged and "fontSize" in sep_item:
        merged["fontSize"] = sep_item["fontSize"]
    if "fontname" not in merged and "fontname" in sep_item:
        merged["fontname"] = sep_item["fontname"]

    return merged


def build_initial_review_items(
    extracted_pages: list[dict[str, Any]] | None,
    pymupdf_items: list[dict[str, Any]],
    *,
    min_size: float = DEFAULT_MIN_LYRICS_SIZE,
    max_size: float = DEFAULT_MAX_LYRICS_SIZE,
) -> list[dict[str, Any]]:
    """검토 UI 초기 상태 — PyMuPDF 전체 줄(제목·작곡 등) + pdfplumber 가사 줄 보강."""
    base: list[dict[str, Any]] = []
    for raw in pymupdf_items:
        if not isinstance(raw, dict) or is_meta_item(raw):
            continue
        item = dict(raw)
        item.pop("lyricPartIndex", None)
        item.pop("lyricVerseIndex", None)
        item.pop("lyricVoice", None)
        item.pop("lyricSkipNotes", None)
        if is_page_number_item(item):
            item["type"] = "page_number"
        elif is_measure_number_item(item):
            item["type"] = "measure_number"
        else:
            item["type"] = "unknown"
        base.append(item)

    if not extracted_pages:
        base.sort(key=lyric_reading_sort_key)
        return base

    sep_items = plumber_pages_to_items(extracted_pages, min_size=min_size, max_size=max_size)
    used_sep: set[str] = set()

    for sep in sep_items:
        match = best_pymupdf_match(sep, base, set())
        if match is not None:
            mid = str(match.get("id", ""))
            for it in base:
                if str(it.get("id", "")) == mid:
                    sep_text = str(sep.get("text") or "").strip()
                    if sep_text:
                        it["text"] = sep_text
                    if sep.get("bbox") is not None:
                        it["bbox"] = sep["bbox"]
                    if sep.get("fontSize") is not None:
                        it["fontSize"] = sep["fontSize"]
                    if sep.get("fontname") is not None:
                        it["fontname"] = sep["fontname"]
                    it["provenance"] = "merged_initial"
                    break
            used_sep.add(str(sep.get("id", "")))
        else:
            extra = dict(sep)
            extra["provenance"] = "pdfplumber"
            if is_page_number_item(extra):
                extra["type"] = "page_number"
            elif is_measure_number_item(extra):
                extra["type"] = "measure_number"
            else:
                extra["type"] = "unknown"
            base.append(extra)

    base.sort(key=lyric_reading_sort_key)
    return base


def merge_sources(
    extracted_pages: list[dict[str, Any]],
    pymupdf_items: list[dict[str, Any]],
    manual_rects: list[dict[str, Any]],
    *,
    min_size: float,
    max_size: float,
) -> dict[str, Any]:
    pymupdf_items = [x for x in pymupdf_items if isinstance(x, dict)]
    sep_items = plumber_pages_to_items(extracted_pages, min_size=min_size, max_size=max_size)
    used_pymupdf: set[str] = set()
    merged_items: list[dict[str, Any]] = []

    for sep in sep_items:
        match = best_pymupdf_match(sep, pymupdf_items, used_pymupdf)
        if match is not None:
            used_pymupdf.add(str(match.get("id", "")))
        merged_items.append(merge_item(sep, match))

    # PyMuPDF에만 있고 pdfplumber와 매칭되지 않은 항목(제목·작곡 등 다른 크기) 보존
    for it in pymupdf_items:
        if is_meta_item(it) or is_measure_number_item(it) or is_page_number_item(it):
            continue
        iid = str(it.get("id", ""))
        if iid in used_pymupdf:
            continue
        extra = dict(it)
        extra["provenance"] = "pymupdf_only"
        merged_items.append(extra)

    merged_items.sort(key=lyric_reading_sort_key)

    match_stats = {
        "pdfplumberLines": len(sep_items),
        "pymupdfItems": len([x for x in pymupdf_items if not is_meta_item(x)]),
        "mergedFromBoth": len([x for x in merged_items if x.get("provenance") == "merged"]),
        "pdfplumberOnly": len([x for x in merged_items if x.get("provenance") == "pdfplumber"]),
        "pymupdfOnly": len([x for x in merged_items if x.get("provenance") == "pymupdf_only"]),
    }

    manifest = {
        "v": MANIFEST_VERSION,
        "pipeline": "font_separator",
        "sources": {
            "pdfplumber": True,
            "pymupdfReview": len(pymupdf_items) > 0,
        },
        "matchStats": match_stats,
        "items": merged_items,
        "pymupdfReviewItems": [dict(x) for x in pymupdf_items if isinstance(x, dict)],
        "manualLyricRects": manual_rects,
    }
    return manifest


def pymupdf_review_to_flat_inject_rows(
    pymupdf_items: list[dict[str, Any]],
    manual_rects: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """PyMuPDF 검토 JSON — 가사 주입의 단일 진실 공급원(성부·순서·텍스트)."""
    rows: list[dict[str, Any]] = []
    for raw in pymupdf_items:
        if not isinstance(raw, dict) or is_meta_item(raw):
            continue
        item = dict(raw)
        item["type"] = resolve_inject_type(item)
        if item["type"] in ("measure_number", "page_number", "unknown"):
            continue
        rows.append(item)
    sort_lyric_items_reading_order(rows)
    if manual_rects:
        rows.append(
            {
                "id": "__manual_lyric_regions__",
                "type": "_manual_lyric_mask",
                "manualRects": manual_rects,
            }
        )
    return rows


def manifest_to_flat_inject_rows(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    """inject_ocr.py용 flat 배열 — PyMuPDF 검토가 있으면 그쪽만 사용(pdfplumber IoU 병합 제외)."""
    manual = manifest.get("manualLyricRects") or []
    sources = manifest.get("sources") or {}
    review_items = manifest.get("pymupdfReviewItems")
    if sources.get("pymupdfReview") and isinstance(review_items, list) and review_items:
        return pymupdf_review_to_flat_inject_rows(review_items, manual)

    items = manifest.get("items") or []
    rows = [
        dict(x)
        for x in items
        if isinstance(x, dict) and x.get("type") not in ("measure_number", "page_number")
    ]
    if manual:
        rows.append(
            {
                "id": "__manual_lyric_regions__",
                "type": "_manual_lyric_mask",
                "manualRects": manual,
            }
        )
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description="pdfplumber·PyMuPDF 검토 결과를 v3 manifest로 병합")
    parser.add_argument("extracted_json", help="extracted_music_text.json (pdfplumber)")
    parser.add_argument("output_manifest", help="lyric_manifest.json (v3) 출력")
    parser.add_argument("--pymupdf-review", dest="pymupdf_review", help="PyMuPDF 검토 ocr_data.json")
    parser.add_argument(
        "--output-flat",
        dest="output_flat",
        help="inject_ocr.py용 flat ocr_data.json (선택)",
    )
    parser.add_argument(
        "--output-initial-review",
        dest="output_initial_review",
        help="검토 UI 초기 상태 flat JSON (PyMuPDF 전체 + pdfplumber 가사)",
    )
    parser.add_argument("--min-size", type=float, default=DEFAULT_MIN_LYRICS_SIZE)
    parser.add_argument("--max-size", type=float, default=DEFAULT_MAX_LYRICS_SIZE)
    args = parser.parse_args()

    pymupdf_items, manual = load_pymupdf_review(args.pymupdf_review)

    extracted_path = Path(args.extracted_json)
    if extracted_path.is_file():
        with open(extracted_path, "r", encoding="utf-8") as f:
            extracted = json.load(f)
    elif args.pymupdf_review and pymupdf_items:
        print(
            f"merge_lyric_sources: {args.extracted_json} 없음 — PyMuPDF 검토만으로 manifest 생성",
            file=sys.stderr,
        )
        extracted = []
    else:
        print(
            f"extracted_json이 없고 PyMuPDF 검토 데이터도 없습니다: {args.extracted_json}",
            file=sys.stderr,
        )
        return 1
    if not isinstance(extracted, list):
        print("extracted_json은 페이지 배열이어야 합니다.", file=sys.stderr)
        return 1

    manifest = merge_sources(
        extracted,
        pymupdf_items,
        manual,
        min_size=args.min_size,
        max_size=args.max_size,
    )

    with open(args.output_manifest, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    if args.output_flat:
        flat = manifest_to_flat_inject_rows(manifest)
        with open(args.output_flat, "w", encoding="utf-8") as f:
            json.dump(flat, f, ensure_ascii=False, indent=2)

    if args.output_initial_review:
        initial = build_initial_review_items(extracted, pymupdf_items, min_size=args.min_size, max_size=args.max_size)
        with open(args.output_initial_review, "w", encoding="utf-8") as f:
            json.dump(initial, f, ensure_ascii=False, indent=2)

    stats = manifest.get("matchStats") or {}
    print(
        f"merge_lyric_sources: pdfplumber {stats.get('pdfplumberLines', 0)}줄, "
        f"pymupdf {stats.get('pymupdfItems', 0)}항목, "
        f"병합 {stats.get('mergedFromBoth', 0)}",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
