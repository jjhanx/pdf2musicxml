#!/usr/bin/env python3
"""pdfplumber 레이아웃 추출, pikepdf 폰트 크기별 텍스트 제거(clean_score_only.pdf)."""
from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any

import pikepdf
import pdfplumber

DEFAULT_MIN_LYRICS_SIZE = 7.0
DEFAULT_MAX_LYRICS_SIZE = 17.0
DEFAULT_LEGACY_RANGES = [(DEFAULT_MIN_LYRICS_SIZE, DEFAULT_MAX_LYRICS_SIZE)]
SIZE_MATCH_EPS = 0.35

# MuseScore 등: 왼쪽 SMuFL 성부 약어(S/A/T/B, PR/PL) — Audiveris SYMBOLS·TEXTS 간섭
# x≤85pt·22.8pt 대만 텍스트 제거. 100pt 전체 픽셀 마스킹은 음자리표·조표·첫 마디(≈47pt~)까지 지움.
DEFAULT_LEFT_MARGIN_TEXT_MAX_X_PT = 85.0
# 선택: 성부 약어 열만 흰색 덮기(0이면 픽셀 마스킹 안 함). 기본 0 — 악보 왼쪽 기호 보존.
DEFAULT_LEFT_MARGIN_VISUAL_WIPE_PT = 0.0
PART_LABEL_SIZE_MIN_PT = 17.5
PART_LABEL_SIZE_MAX_PT = 28.0
LEFT_MARGIN_SMALL_TEXT_MAX_PT = 14.0
LEFT_MARGIN_SMALL_TEXT_MAX_X_PT = 50.0

_HANGUL_RE = re.compile(r"[\uAC00-\uD7A3\u1100-\u11FF\u3131-\u318E]")
_LATIN_RE = re.compile(r"[A-Za-z\u00C0-\u024F]")


def parse_ranges_spec(spec: str | None) -> list[tuple[float, float]]:
    """'7-17,18-24.5' → [(7,17),(18,24.5)]"""
    if not spec or not str(spec).strip():
        return list(DEFAULT_LEGACY_RANGES)
    out: list[tuple[float, float]] = []
    for part in str(spec).split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            lo, hi = float(a.strip()), float(b.strip())
        else:
            sz = float(part.strip())
            lo, hi = sz - SIZE_MATCH_EPS, sz + SIZE_MATCH_EPS
        if lo > hi:
            lo, hi = hi, lo
        out.append((lo, hi))
    return merge_ranges(out) if out else list(DEFAULT_LEGACY_RANGES)


def merge_ranges(ranges: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if not ranges:
        return []
    sorted_r = sorted(ranges, key=lambda x: (x[0], x[1]))
    merged: list[list[float]] = [[sorted_r[0][0], sorted_r[0][1]]]
    for lo, hi in sorted_r[1:]:
        if lo <= merged[-1][1] + 0.05:
            merged[-1][1] = max(merged[-1][1], hi)
        else:
            merged.append([lo, hi])
    return [(a, b) for a, b in merged]


def sizes_to_ranges(sizes: list[float], *, tol: float = SIZE_MATCH_EPS) -> list[tuple[float, float]]:
    if not sizes:
        return []
    uniq = sorted({round(float(s), 2) for s in sizes})
    return merge_ranges([(s - tol, s + tol) for s in uniq])


def font_size_in_ranges(size: float, ranges: list[tuple[float, float]]) -> bool:
    for lo, hi in ranges:
        if lo <= size <= hi:
            return True
    return False


def _multiply_matrix(m1: list[float], m2: list[float]) -> list[float]:
    a1, b1, c1, d1, e1, f1 = m1
    a2, b2, c2, d2, e2, f2 = m2
    return [
        a1 * a2 + b1 * c2,
        a1 * b2 + b1 * d2,
        c1 * a2 + d1 * c2,
        c1 * b2 + d1 * d2,
        a1 * e2 + b1 * f2 + e1,
        c1 * e2 + d1 * f2 + f1,
    ]


def _effective_font_size_pt(tf_size: float, ctm: list[float], tm: list[float]) -> float:
    """pdfplumber size ≈ Tf × |CTM| × |Tm| (악보 PDF는 대부분 축 정렬)."""
    if tf_size <= 0:
        return 0.0
    ctm_scale = max(abs(ctm[0]), abs(ctm[3]))
    tm_scale = max(abs(tm[0]), abs(tm[3]))
    return tf_size * ctm_scale * tm_scale


def _text_x_pt(tm: list[float]) -> float:
    return float(tm[4])


def _should_strip_text(
    eff: float,
    tm: list[float],
    ranges: list[tuple[float, float]],
    *,
    strip_left_margin: bool,
) -> bool:
    if strip_left_margin:
        x = _text_x_pt(tm)
        if x <= DEFAULT_LEFT_MARGIN_TEXT_MAX_X_PT:
            if PART_LABEL_SIZE_MIN_PT <= eff <= PART_LABEL_SIZE_MAX_PT:
                return True
        if x <= LEFT_MARGIN_SMALL_TEXT_MAX_X_PT and 0 < eff <= LEFT_MARGIN_SMALL_TEXT_MAX_PT:
            return True
    return font_size_in_ranges(eff, ranges)


def _strip_commands_in_stream(
    commands: list,
    ranges: list[tuple[float, float]],
    *,
    initial_ctm: list[float] | None = None,
    strip_left_margin: bool = True,
) -> list:
    ctm_stack: list[list[float]] = [list(initial_ctm or [1.0, 0.0, 0.0, 1.0, 0.0, 0.0])]
    current_font_size = 0.0
    tm = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
    clean_commands = []

    for operands, operator in commands:
        op_name = str(operator)

        if op_name == "q":
            ctm_stack.append(list(ctm_stack[-1]))
        elif op_name == "Q":
            if len(ctm_stack) > 1:
                ctm_stack.pop()
        elif op_name == "cm" and len(operands) >= 6:
            m2 = [float(operands[i]) for i in range(6)]
            ctm_stack[-1] = _multiply_matrix(ctm_stack[-1], m2)
        elif op_name == "BT":
            tm = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
        elif op_name == "Tf" and len(operands) > 1:
            try:
                current_font_size = float(operands[1])
            except (ValueError, TypeError):
                current_font_size = 0.0
        elif op_name == "Tm" and len(operands) >= 6:
            tm = [float(operands[i]) for i in range(6)]

        if op_name in ["Tj", "TJ", "'", '"']:
            eff = _effective_font_size_pt(current_font_size, ctm_stack[-1], tm)
            if (
                _should_strip_text(eff, tm, ranges, strip_left_margin=strip_left_margin)
                and operands
            ):
                if op_name == "TJ":
                    operands[0] = pikepdf.Array([])
                else:
                    operands[0] = pikepdf.String("")

        clean_commands.append((operands, operator))

    return clean_commands


def extract_layout(input_pdf_path: str, output_json_path: str) -> None:
    print("[extract] pdfplumber로 문자 레이아웃 추출 중...", file=sys.stderr)
    extracted_data = []
    with pdfplumber.open(input_pdf_path) as pdf:
        for page_idx, page in enumerate(pdf.pages):
            page_info = {
                "page_number": page_idx + 1,
                "width": float(page.width),
                "height": float(page.height),
                "text_elements": [],
            }
            for char in page.chars:
                char_info = {
                    "raw_text": char["text"],
                    "x0": round(float(char["x0"]), 2),
                    "y0": round(float(char["y0"]), 2),
                    "x1": round(float(char["x1"]), 2),
                    "y1": round(float(char["y1"]), 2),
                    "fontname": char.get("fontname", "Unknown"),
                    "size": round(float(char["size"]), 2),
                }
                page_info["text_elements"].append(char_info)
            extracted_data.append(page_info)

    with open(output_json_path, "w", encoding="utf-8") as f:
        json.dump(extracted_data, f, ensure_ascii=False, indent=2)
    print(f" -> {output_json_path}", file=sys.stderr)


def strip_font_ranges(
    input_pdf_path: str,
    output_pdf_path: str,
    ranges: list[tuple[float, float]],
    *,
    strip_left_margin: bool = True,
    left_margin_visual_wipe_pt: float | None = None,
) -> None:
    if not ranges:
        raise ValueError("제거할 폰트 크기 범위가 비어 있습니다.")
    ranges = merge_ranges(ranges)
    desc = ", ".join(f"{lo:g}–{hi:g}pt" for lo, hi in ranges)
    margin_note = (
        f", 왼쪽 x≤{DEFAULT_LEFT_MARGIN_TEXT_MAX_X_PT:g}pt 성부약어(텍스트)"
        if strip_left_margin
        else ""
    )
    print(f"[strip] pikepdf로 {desc}{margin_note} 텍스트 제거 중...", file=sys.stderr)

    with pikepdf.open(input_pdf_path) as pdf:
        for page in pdf.pages:
            if "/Contents" not in page:
                continue
            try:
                commands = pikepdf.parse_content_stream(page)
            except Exception:
                continue

            clean_commands = _strip_commands_in_stream(
                commands,
                ranges,
                strip_left_margin=strip_left_margin,
            )
            page.Contents = pdf.make_stream(pikepdf.unparse_content_stream(clean_commands))

        pdf.save(output_pdf_path, linearize=True)

    wipe_pt = (
        DEFAULT_LEFT_MARGIN_VISUAL_WIPE_PT
        if left_margin_visual_wipe_pt is None
        else float(left_margin_visual_wipe_pt)
    )
    if strip_left_margin and wipe_pt > 0:
        _wipe_left_margin_visual(output_pdf_path, wipe_pt)

    print(f" -> {output_pdf_path}", file=sys.stderr)


def _wipe_left_margin_visual(pdf_path: str, margin_pt: float) -> None:
    """SMuFL 성부 약어가 텍스트 연산자만 지워져도 픽셀에 남는 경우 — Audiveris 이진화 입력에서 제거."""
    try:
        import fitz
    except ImportError as e:
        print(f"[strip] PyMuPDF 없음, 왼쪽 여백 픽셀 마스킹 생략: {e}", file=sys.stderr)
        return

    img_none = getattr(fitz, "PDF_REDACT_IMAGE_NONE", 0)
    line_none = getattr(fitz, "PDF_REDACT_LINE_ART_NONE", 0)
    tmp_path = f"{pdf_path}.margin-wipe.pdf"

    doc = fitz.open(pdf_path)
    for page in doc:
        rect = fitz.Rect(0, 0, margin_pt, page.rect.height)
        page.add_redact_annot(rect, fill=(1, 1, 1))
        try:
            page.apply_redactions(images=img_none, graphics=line_none)
        except TypeError:
            page.apply_redactions()
    doc.save(tmp_path, garbage=4, deflate=True)
    doc.close()

    import os
    import shutil

    shutil.move(tmp_path, pdf_path)
    print(
        f"[strip] 왼쪽 x≤{margin_pt:g}pt 픽셀 마스킹(PyMuPDF) — Audiveris TEXTS/SYMBOLS 간섭 완화",
        file=sys.stderr,
    )


def _sample_text(chars: list[str], max_len: int = 48) -> str:
    s = "".join(chars).strip()
    s = re.sub(r"\s+", " ", s)
    if len(s) > max_len:
        return s[: max_len - 1] + "…"
    return s


def analyze_font_sizes(extracted_pages: list[dict[str, Any]]) -> dict[str, Any]:
    """extracted_music_text.json 페이지 배열 → UI용 통계."""
    buckets: dict[float, dict[str, Any]] = {}

    for page in extracted_pages:
        page_num = int(page.get("page_number", 1))
        elements = page.get("text_elements") or []
        if not isinstance(elements, list):
            continue
        for ch in elements:
            if not isinstance(ch, dict):
                continue
            try:
                sz = round(float(ch.get("size", 0)), 2)
            except (TypeError, ValueError):
                continue
            if sz <= 0:
                continue
            text = str(ch.get("raw_text", ""))
            if not text.strip():
                continue

            b = buckets.setdefault(
                sz,
                {
                    "sizePt": sz,
                    "charCount": 0,
                    "sampleChars": [],
                    "fontnames": {},
                    "pages": set(),
                    "hasHangul": False,
                    "hasLatin": False,
                },
            )
            b["charCount"] += 1
            b["pages"].add(page_num)
            fn = str(ch.get("fontname", "Unknown"))
            b["fontnames"][fn] = b["fontnames"].get(fn, 0) + 1
            if len(b["sampleChars"]) < 120:
                b["sampleChars"].append(text)
            if _HANGUL_RE.search(text):
                b["hasHangul"] = True
            if _LATIN_RE.search(text):
                b["hasLatin"] = True

    entries = []
    for sz in sorted(buckets.keys()):
        b = buckets[sz]
        top_fonts = sorted(b["fontnames"].items(), key=lambda x: -x[1])[:3]
        entries.append(
            {
                "sizePt": b["sizePt"],
                "charCount": b["charCount"],
                "pageCount": len(b["pages"]),
                "sampleText": _sample_text(b["sampleChars"]),
                "fontnames": [f[0] for f in top_fonts],
                "hasHangul": b["hasHangul"],
                "hasLatin": b["hasLatin"],
            }
        )

    default_ranges = [{"minPt": DEFAULT_MIN_LYRICS_SIZE, "maxPt": DEFAULT_MAX_LYRICS_SIZE, "label": "가사(기본 7–17pt)"}]
    suggested_ranges: list[dict[str, Any]] = []
    suggested_sizes: list[float] = []

    for e in entries:
        sz = float(e["sizePt"])
        if sz < DEFAULT_MIN_LYRICS_SIZE or sz > DEFAULT_MAX_LYRICS_SIZE:
            if (e["hasHangul"] or e["hasLatin"]) and sz <= 48:
                suggested_sizes.append(sz)
                label = "제목·메타 후보" if sz >= 14 else "소형 메타"
                suggested_ranges.append(
                    {
                        "minPt": round(sz - SIZE_MATCH_EPS, 2),
                        "maxPt": round(sz + SIZE_MATCH_EPS, 2),
                        "label": f"{label} ({sz:g}pt)",
                        "sizePt": sz,
                    }
                )

    # 인접 제안 크기를 범위로 묶기
    if suggested_sizes:
        merged_meta = sizes_to_ranges(suggested_sizes)
        if len(merged_meta) <= 4:
            for lo, hi in merged_meta:
                if hi < DEFAULT_MIN_LYRICS_SIZE or lo > DEFAULT_MAX_LYRICS_SIZE:
                    suggested_ranges.append(
                        {
                            "minPt": round(lo, 2),
                            "maxPt": round(hi, 2),
                            "label": f"메타 묶음 {lo:g}–{hi:g}pt",
                        }
                    )

    presets = [
        {"id": "lyrics", "label": "가사 (7–17pt)", "ranges": [{"minPt": 7, "maxPt": 17}]},
        {"id": "meta_small", "label": "작곡·저작 12–20pt", "ranges": [{"minPt": 12, "maxPt": 20}]},
        {"id": "title", "label": "큰 제목 18–36pt", "ranges": [{"minPt": 18, "maxPt": 36}]},
        {"id": "all_meta", "label": "가사+메타 (7–36pt)", "ranges": [{"minPt": 7, "maxPt": 36}]},
    ]

    return {
        "entries": entries,
        "defaultRanges": default_ranges,
        "suggestedRanges": suggested_ranges,
        "presets": presets,
        "note": (
            "20pt 이상 SMuFL(예: 22.8pt)은 음표 글림과 같을 수 있으나, 왼쪽 x≤85pt 성부 약어(S/A/T/B·PR/PL) 텍스트는 "
            "strip 시 자동 제거됩니다(음자리표·조표는 보존 — 전체 왼쪽 픽셀 마스킹은 기본 끔). "
            "가사·제목·작곡 등 inject_ocr로 넣을 텍스트만 UI에서 고르세요."
        ),
    }


def load_extracted_pages(path: str) -> list[dict[str, Any]]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError("extracted JSON은 페이지 배열이어야 합니다.")
    return data


def cmd_extract(args: argparse.Namespace) -> int:
    extract_layout(args.input_pdf, args.output_json)
    return 0


def cmd_strip(args: argparse.Namespace) -> int:
    ranges = parse_ranges_spec(args.ranges)
    if args.sizes:
        extra = sizes_to_ranges([float(x) for x in args.sizes.split(",") if x.strip()])
        ranges = merge_ranges(ranges + extra)
    strip_font_ranges(
        args.input_pdf,
        args.output_pdf,
        ranges,
        strip_left_margin=not getattr(args, "no_strip_left_margin", False),
        left_margin_visual_wipe_pt=getattr(args, "left_margin_wipe_pt", None),
    )
    return 0


def cmd_analyze(args: argparse.Namespace) -> int:
    pages = load_extracted_pages(args.extracted_json)
    stats = analyze_font_sizes(pages)
    json.dump(stats, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


def cmd_all(args: argparse.Namespace) -> int:
    ranges = parse_ranges_spec(args.ranges)
    if args.sizes:
        extra = sizes_to_ranges([float(x) for x in args.sizes.split(",") if x.strip()])
        ranges = merge_ranges(ranges + extra)
    extract_layout(args.input_pdf, args.output_json)
    strip_font_ranges(
        args.input_pdf,
        args.output_pdf,
        ranges,
        strip_left_margin=not getattr(args, "no_strip_left_margin", False),
        left_margin_visual_wipe_pt=getattr(args, "left_margin_wipe_pt", None),
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="PDF 가사·메타 텍스트 분리 (pdfplumber + pikepdf)")
    sub = parser.add_subparsers(dest="command")

    p_extract = sub.add_parser("extract", help="pdfplumber 레이아웃 JSON만 추출")
    p_extract.add_argument("input_pdf")
    p_extract.add_argument("output_json")
    p_extract.set_defaults(func=cmd_extract)

    p_strip = sub.add_parser("strip", help="선택 폰트 크기 텍스트만 pikepdf로 제거")
    p_strip.add_argument("input_pdf")
    p_strip.add_argument("output_pdf")
    p_strip.add_argument("--ranges", default="7-17", help="예: 7-17,18-24")
    p_strip.add_argument("--sizes", help="개별 pt, 쉼표 구분. 예: 12,18,24")
    p_strip.add_argument(
        "--no-strip-left-margin",
        action="store_true",
        help="왼쪽 SMuFL 성부 약어(PR/PL 등) 자동 제거 끔",
    )
    p_strip.add_argument(
        "--left-margin-wipe-pt",
        type=float,
        default=None,
        metavar="PT",
        help=(
            "왼쪽 세로 띠 픽셀 흰색 마스킹(기본 0=안 함). "
            "큰 값은 음자리표·조표·첫 마디까지 지울 수 있음"
        ),
    )
    p_strip.set_defaults(func=cmd_strip)

    p_analyze = sub.add_parser("analyze", help="extracted JSON에서 폰트 크기 통계(JSON stdout)")
    p_analyze.add_argument("extracted_json")
    p_analyze.set_defaults(func=cmd_analyze)

    p_all = sub.add_parser("all", help="extract + strip 한 번에")
    p_all.add_argument("input_pdf")
    p_all.add_argument("output_json")
    p_all.add_argument("output_pdf")
    p_all.add_argument("--ranges", default="7-17")
    p_all.add_argument("--sizes")
    p_all.set_defaults(func=cmd_all)

    # 레거시: 3 positional = all
    parser.add_argument("legacy_input", nargs="?", help=argparse.SUPPRESS)
    parser.add_argument("legacy_json", nargs="?", help=argparse.SUPPRESS)
    parser.add_argument("legacy_pdf", nargs="?", help=argparse.SUPPRESS)
    parser.add_argument("--min-size", type=float, default=DEFAULT_MIN_LYRICS_SIZE)
    parser.add_argument("--max-size", type=float, default=DEFAULT_MAX_LYRICS_SIZE)
    parser.add_argument("--ranges", help=argparse.SUPPRESS)

    args = parser.parse_args()
    if args.command:
        return args.func(args)

    if args.legacy_input and args.legacy_json and args.legacy_pdf:
        legacy = argparse.Namespace(
            input_pdf=args.legacy_input,
            output_json=args.legacy_json,
            output_pdf=args.legacy_pdf,
            ranges=args.ranges or f"{args.min_size}-{args.max_size}",
            sizes=None,
        )
        return cmd_all(legacy)

    parser.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
