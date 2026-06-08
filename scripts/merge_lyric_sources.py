#!/usr/bin/env python3
"""pdfplumber 추출과 PyMuPDF 검토 결과를 MusicXML 주입용 manifest(v3)로 병합합니다."""
from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any

MANIFEST_VERSION = 3
DEFAULT_MIN_LYRICS_SIZE = 7.0
DEFAULT_MAX_LYRICS_SIZE = 17.0
Y_TOLERANCE_PT = 4.0
IOU_MATCH_THRESHOLD = 0.25


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
        merged["type"] = merged.get("type") if merged.get("type") not in (None, "unknown") else "lyrics"
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

    if merged.get("type") in (None, "unknown"):
        merged["type"] = pymupdf_item.get("type") or "lyrics"
    if merged.get("type") == "unknown":
        merged["type"] = "lyrics"

    if "fontSize" not in merged and "fontSize" in sep_item:
        merged["fontSize"] = sep_item["fontSize"]
    if "fontname" not in merged and "fontname" in sep_item:
        merged["fontname"] = sep_item["fontname"]

    return merged


def merge_sources(
    extracted_pages: list[dict[str, Any]],
    pymupdf_items: list[dict[str, Any]],
    manual_rects: list[dict[str, Any]],
    *,
    min_size: float,
    max_size: float,
) -> dict[str, Any]:
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
        if is_meta_item(it):
            continue
        iid = str(it.get("id", ""))
        if iid in used_pymupdf:
            continue
        extra = dict(it)
        extra["provenance"] = "pymupdf_only"
        merged_items.append(extra)

    merged_items.sort(key=lambda it: (int(it.get("page", 1)), float(it.get("y", 0)), float(it.get("x", 0))))

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
        "manualLyricRects": manual_rects,
    }
    return manifest


def manifest_to_flat_inject_rows(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    items = manifest.get("items") or []
    manual = manifest.get("manualLyricRects") or []
    rows = [dict(x) for x in items if isinstance(x, dict)]
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
    parser.add_argument("--min-size", type=float, default=DEFAULT_MIN_LYRICS_SIZE)
    parser.add_argument("--max-size", type=float, default=DEFAULT_MAX_LYRICS_SIZE)
    args = parser.parse_args()

    with open(args.extracted_json, "r", encoding="utf-8") as f:
        extracted = json.load(f)
    if not isinstance(extracted, list):
        print("extracted_json은 페이지 배열이어야 합니다.", file=sys.stderr)
        return 1

    pymupdf_items, manual = load_pymupdf_review(args.pymupdf_review)
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

    stats = manifest.get("matchStats") or {}
    print(
        f"merge_lyric_sources: pdfplumber {stats.get('pdfplumberLines', 0)}줄, "
        f"pymupdf {stats.get('pymupdfItems', 0)}항목, "
        f"병합 {stats.get('mergedFromBoth', 0)}",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
