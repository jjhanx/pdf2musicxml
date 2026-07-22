#!/usr/bin/env python3
"""pdfplumber 레이아웃 추출, pikepdf 폰트 크기별 텍스트 제거(clean_score_only.pdf)."""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

import pikepdf
import pdfplumber

DEFAULT_MIN_LYRICS_SIZE = 7.0
DEFAULT_MAX_LYRICS_SIZE = 17.0
DEFAULT_LEGACY_RANGES = [(DEFAULT_MIN_LYRICS_SIZE, DEFAULT_MAX_LYRICS_SIZE)]
SIZE_MATCH_EPS = 0.35
# NWC·SMuFL 등 악보 글꼴 — pt 범위에 넣어도 strip 금지(7–36pt 선택 시 22.8pt 음표 전멸 방지).
_MUSIC_FONT_HINTS = (
    "NWC",
    "BRAVURA",
    "SMUFL",
    "MAESTRO",
    "OPUS",
    "ENGRAVER",
    "PETALUMA",
    "GONVILL",
    "LELAND",
    "MUSEJAZZ",
    "MUSEJAZZTEXT",
)
# 표시 pt가 이 값 이상이면 lyrics·제목이 아닌 악보 SMuFL(≈22.8pt)로 간주해 strip 생략.
_MUSIC_GLYPH_MIN_PT = 18.0


def _is_music_font_name(name: str) -> bool:
    u = (name or "").upper().replace(" ", "")
    return any(h in u for h in _MUSIC_FONT_HINTS)


def _should_strip_shown_glyph(current_font: str, eff_pt: float, ranges: list[tuple[float, float]]) -> bool:
    if not font_size_in_ranges(eff_pt, ranges):
        return False
    if _is_music_font_name(current_font):
        return False
    if eff_pt >= _MUSIC_GLYPH_MIN_PT:
        return False
    return True


def _blank_pdf_string(text: str, *, replacement: str = " ") -> pikepdf.String:
    if not text:
        return pikepdf.String("")
    rep = (replacement or " ")[:1]
    return pikepdf.String(rep * len(text))


def _blank_tj_array(arr, *, replacement: str = " "):
    out = pikepdf.Array()
    for item in arr:
        if isinstance(item, (int, float)):
            out.append(item)
        else:
            out.append(_blank_pdf_string(str(item), replacement=replacement))
    return out

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


def _strip_commands_in_stream(
    commands: list,
    ranges: list[tuple[float, float]],
    *,
    initial_ctm: list[float] | None = None,
) -> list:
    ctm_stack: list[list[float]] = [list(initial_ctm or [1.0, 0.0, 0.0, 1.0, 0.0, 0.0])]
    current_font = ""
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
            current_font = str(operands[0])
            try:
                current_font_size = float(operands[1])
            except (ValueError, TypeError):
                current_font_size = 0.0
        elif op_name == "Tm" and len(operands) >= 6:
            tm = [float(operands[i]) for i in range(6)]

        if op_name in ["Tj", "TJ", "'", '"']:
            eff = _effective_font_size_pt(current_font_size, ctm_stack[-1], tm)
            if operands and _should_strip_shown_glyph(current_font, eff, ranges):
                if op_name == "TJ":
                    operands[0] = _blank_tj_array(operands[0])
                else:
                    operands[0] = _blank_pdf_string(str(operands[0]))

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


def replace_f073_triplets(pdf_path: str) -> None:
    import fitz
    import os

    prev_glyph_h = fitz.TOOLS.set_small_glyph_heights(None)
    fitz.TOOLS.set_small_glyph_heights(True)

    img = getattr(fitz, "PDF_REDACT_IMAGE_NONE", 0)
    gra = getattr(fitz, "PDF_REDACT_LINE_ART_NONE", 0)
    txt = getattr(fitz, "PDF_REDACT_TEXT_REMOVE", 0)

    doc = fitz.open(pdf_path)
    temp_pdf_path = pdf_path + ".tmp"
    saved = False
    try:
        redacts_total = 0
        for page_idx in range(len(doc)):
            page = doc[page_idx]
            td = page.get_text("dict")
            redacts_added = 0
            for b in td.get("blocks", []):
                if b.get("type") != 0:
                    continue
                for l in b.get("lines", []):
                    for s in l.get("spans", []):
                        chars = s.get("chars")
                        if chars:
                            for ch in chars:
                                c = ch.get("c") or ""
                                if len(c) == 1 and ord(c) == 0xF073:
                                    bbox = fitz.Rect(ch["bbox"]).normalize()
                                    page.add_redact_annot(
                                        bbox,
                                        text="3",
                                        fontname="helv",
                                        fontsize=s["size"],
                                        align=1,
                                        fill=False,
                                        text_color=(0, 0, 0),
                                        cross_out=False
                                    )
                                    redacts_added += 1
                        else:
                            txt_val = s.get("text") or ""
                            if not txt_val:
                                continue
                            sx0, sy0, sx1, sy1 = s["bbox"]
                            dw = (sx1 - sx0) / len(txt_val)
                            for i, c in enumerate(txt_val):
                                if ord(c) == 0xF073:
                                    bbox = fitz.Rect(sx0 + i * dw, sy0, sx0 + (i + 1) * dw, sy1).normalize()
                                    page.add_redact_annot(
                                        bbox,
                                        text="3",
                                        fontname="helv",
                                        fontsize=s["size"],
                                        align=1,
                                        fill=False,
                                        text_color=(0, 0, 0),
                                        cross_out=False
                                    )
                                    redacts_added += 1
            if redacts_added > 0:
                applied = False
                safe_kw = {"images": img, "graphics": gra, "text": txt}
                try:
                    page.apply_redactions(**safe_kw)
                    applied = True
                except (TypeError, ValueError):
                    pass
                if not applied:
                    try:
                        page.apply_redactions(img, gra, txt)
                        applied = True
                    except (TypeError, ValueError):
                        pass
                if applied:
                    redacts_total += redacts_added
                else:
                    print(f"[pdf_separator] apply_redactions failed on page {page_idx+1}", file=sys.stderr)

        if redacts_total > 0:
            doc.save(temp_pdf_path, deflate=True, garbage=3)
            saved = True
            print(f"[pdf_separator] Replaced {redacts_total} PUA triplet characters with standard '3'", file=sys.stderr)
    finally:
        doc.close()
        fitz.TOOLS.set_small_glyph_heights(prev_glyph_h)
        if saved:
            if os.path.exists(pdf_path):
                try:
                    os.remove(pdf_path)
                except Exception:
                    pass
            os.replace(temp_pdf_path, pdf_path)


def strip_font_ranges(
    input_pdf_path: str,
    output_pdf_path: str,
    ranges: list[tuple[float, float]],
    *,
    replace_triplet_pua: bool = False,
) -> None:
    if not ranges:
        raise ValueError("제거할 폰트 크기 범위가 비어 있습니다.")
    ranges = merge_ranges(ranges)
    desc = ", ".join(f"{lo:g}–{hi:g}pt" for lo, hi in ranges)
    print(f"[strip] pikepdf로 {desc} 텍스트 제거 중...", file=sys.stderr)

    with pikepdf.open(input_pdf_path) as pdf:
        for page in pdf.pages:
            if "/Contents" not in page:
                continue
            try:
                commands = pikepdf.parse_content_stream(page)
            except Exception:
                continue

            clean_commands = _strip_commands_in_stream(commands, ranges)
            page.Contents = pdf.make_stream(pikepdf.unparse_content_stream(clean_commands))

        pdf.save(output_pdf_path, linearize=True)

    if replace_triplet_pua:
        try:
            replace_f073_triplets(output_pdf_path)
        except Exception as e:
            print(f"[pdf_separator] Triplet replacement failed: {e}", file=sys.stderr)

    print(f" -> {output_pdf_path}", file=sys.stderr)


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
            "UI에서 고른 pt 범위의 텍스트만 제거합니다(CTM 반영 표시 pt). "
            "22.8pt NWC·SMuFL **악보 글꼴**은 범위에 7–36pt를 넣어도 **자동 보호**합니다. "
            "그래도 **가사(7–17pt)** 만 고르는 것을 권장합니다. "
            "가사·제목·작곡 등 inject_ocr로 넣을 텍스트만 고르세요."
        ),
    }


def load_extracted_pages(path: str) -> list[dict[str, Any]]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError("extracted JSON은 페이지 배열이어야 합니다.")
    return data


_TITLE_LINE_Y_TOL_PT = 4.0
_TITLE_TOP_FRAC = 0.28
_MEASURE_NUM_RE = re.compile(r"^\d{1,3}$")


def _cluster_chars_to_lines(
    chars: list[dict[str, Any]],
    *,
    y_tol: float = _TITLE_LINE_Y_TOL_PT,
) -> list[list[dict[str, Any]]]:
    usable: list[dict[str, Any]] = []
    for ch in chars:
        if not isinstance(ch, dict):
            continue
        text = str(ch.get("raw_text", "")).strip()
        if not text:
            continue
        try:
            y_center = (float(ch["y0"]) + float(ch["y1"])) / 2.0
        except (KeyError, TypeError, ValueError):
            continue
        usable.append({**ch, "_y_center": y_center})
    usable.sort(key=lambda c: (c["_y_center"], float(c.get("x0", 0))))
    lines: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    for ch in usable:
        if not current:
            current = [ch]
            continue
        avg_y = sum(x["_y_center"] for x in current) / len(current)
        if abs(ch["_y_center"] - avg_y) <= y_tol:
            current.append(ch)
        else:
            lines.append(current)
            current = [ch]
    if current:
        lines.append(current)
    return lines


def _line_bbox(line_chars: list[dict[str, Any]]) -> list[float]:
    xs0 = [float(c["x0"]) for c in line_chars]
    ys0 = [float(c["y0"]) for c in line_chars]
    xs1 = [float(c["x1"]) for c in line_chars]
    ys1 = [float(c["y1"]) for c in line_chars]
    return [min(xs0), min(ys0), max(xs1), max(ys1)]


def _line_merged_text(line_chars: list[dict[str, Any]]) -> str:
    line_chars = sorted(line_chars, key=lambda c: float(c.get("x0", 0)))
    merged = ""
    for i, ch in enumerate(line_chars):
        if i > 0:
            prev = line_chars[i - 1]
            gap = float(ch["x0"]) - float(prev["x1"])
            if gap > 3:
                merged += " "
        merged += str(ch.get("raw_text", ""))
    return re.sub(r"\s+", " ", merged).strip()


def detect_title_candidate_from_pages(pages: list[dict[str, Any]]) -> dict[str, Any] | None:
    """1페이지 상단 한글 한 줄 — 가사·제목 pt가 같을 때 bbox 마스킹·수동 제목 입력용."""
    if not pages:
        return None
    page1 = next((p for p in pages if int(p.get("page_number", 0)) == 1), pages[0])
    try:
        page_h = float(page1.get("height") or 842.0)
    except (TypeError, ValueError):
        page_h = 842.0
    top_limit = page_h * _TITLE_TOP_FRAC
    chars = page1.get("text_elements") or []
    if not isinstance(chars, list):
        return None

    candidates: list[dict[str, Any]] = []
    for line_chars in _cluster_chars_to_lines(chars):
        bbox = _line_bbox(line_chars)
        if bbox[1] > top_limit:
            continue
        text = _line_merged_text(line_chars)
        if not text or not _HANGUL_RE.search(text):
            continue
        if _MEASURE_NUM_RE.fullmatch(text.replace(" ", "")):
            continue
        if len(text.replace(" ", "")) > 48:
            continue
        sizes = [float(c.get("size", 0) or 0) for c in line_chars if float(c.get("size", 0) or 0) > 0]
        avg_size = round(sum(sizes) / len(sizes), 2) if sizes else None
        candidates.append(
            {
                "text": text,
                "page": 1,
                "bbox": bbox,
                "fontSize": avg_size,
                "y0": bbox[1],
            }
        )
    if not candidates:
        return None
    candidates.sort(key=lambda c: (c["y0"], -len(str(c["text"]))))
    best = candidates[0]
    return {
        "text": best["text"],
        "page": 1,
        "bbox": best["bbox"],
        "fontSize": best.get("fontSize"),
        "detected": True,
    }


def detect_title_candidate(extracted_json_path: str) -> dict[str, Any] | None:
    pages = load_extracted_pages(extracted_json_path)
    return detect_title_candidate_from_pages(pages)


def detect_title_candidate_from_pdf(pdf_path: str) -> dict[str, Any] | None:
    """clean_score_only.pdf에서 PyMuPDF로 1페이지 상단 한글 제목 bbox 감지."""
    import fitz

    path = Path(pdf_path)
    if not path.is_file():
        return None
    doc = fitz.open(str(path))
    try:
        if len(doc) < 1:
            return None
        page = doc[0]
        page_h = float(page.rect.height or 842.0)
        top_limit = page_h * _TITLE_TOP_FRAC
        flags = int(getattr(fitz, "TEXT_ACCURATE_BBOXES", 0) or 0)
        raw = page.get_text("rawdict", flags=flags)
        line_chars: list[list[dict[str, Any]]] = []
        current: list[dict[str, Any]] = []
        last_y: float | None = None
        for block in raw.get("blocks") or []:
            if block.get("type") != 0:
                continue
            for line in block.get("lines") or []:
                for span in line.get("spans") or []:
                    for ch in span.get("chars") or []:
                        c = str(ch.get("c") or "")
                        if not c or _char_is_music_glyph(ord(c[0])):
                            continue
                        bbox = ch.get("bbox") or [0, 0, 0, 0]
                        y0 = float(bbox[1])
                        if last_y is not None and abs(y0 - last_y) > 4:
                            if current:
                                line_chars.append(current)
                            current = []
                        last_y = y0
                        current.append(
                            {
                                "x0": float(bbox[0]),
                                "y0": y0,
                                "x1": float(bbox[2]),
                                "y1": float(bbox[3]),
                                "raw_text": c,
                                "size": float(span.get("size") or 0),
                            }
                        )
        if current:
            line_chars.append(current)
        candidates: list[dict[str, Any]] = []
        for chars in line_chars:
            bbox = _line_bbox(chars)
            if bbox[1] > top_limit:
                continue
            text = _line_merged_text(chars)
            if not text or not _HANGUL_RE.search(text):
                continue
            if _MEASURE_NUM_RE.fullmatch(text.replace(" ", "")):
                continue
            sizes = [float(c.get("size", 0) or 0) for c in chars if float(c.get("size", 0) or 0) > 0]
            avg_size = round(sum(sizes) / len(sizes), 2) if sizes else None
            candidates.append(
                {
                    "text": text,
                    "page": 1,
                    "bbox": bbox,
                    "fontSize": avg_size,
                    "y0": bbox[1],
                    "detected": True,
                    "source": "pymupdf_pdf",
                }
            )
        if not candidates:
            return None
        candidates.sort(key=lambda c: (c["y0"], -len(str(c["text"]))))
        return candidates[0]
    finally:
        doc.close()


def _char_is_music_glyph(cp: int) -> bool:
    if 0xE000 <= cp <= 0xF8FF:
        return True
    if 0x1D100 <= cp <= 0x1D1FF:
        return True
    if cp in (0x2669, 0x266A, 0x266B, 0x266C):
        return True
    if 0xF0000 <= cp <= 0xFFFFD or 0x100000 <= cp <= 0x10FFFD:
        return True
    return False


def _apply_page_redactions(page, *, remove_line_art: bool = False) -> bool:
    import fitz

    img = int(getattr(fitz, "PDF_REDACT_IMAGE_NONE", 0))
    gra = int(
        getattr(fitz, "PDF_REDACT_LINE_ART_REMOVE", 2)
        if remove_line_art
        else getattr(fitz, "PDF_REDACT_LINE_ART_NONE", 0)
    )
    txt = int(getattr(fitz, "PDF_REDACT_TEXT_REMOVE", 0))
    safe_kw = {"images": img, "graphics": gra, "text": txt}
    try:
        page.apply_redactions(**safe_kw)
        return True
    except (TypeError, ValueError):
        pass
    try:
        page.apply_redactions(img, gra, txt)
        return True
    except (TypeError, ValueError):
        pass
    return False


def _count_text_chars_in_rect(page, clip, flags: int) -> int:
    import fitz

    n = 0
    raw = page.get_text("rawdict", flags=flags)
    for block in raw.get("blocks") or []:
        if block.get("type") != 0:
            continue
        for line in block.get("lines") or []:
            for span in line.get("spans") or []:
                for ch in span.get("chars") or []:
                    cb = fitz.Rect(ch.get("bbox") or [0, 0, 0, 0]).normalize()
                    if (clip & cb).is_empty:
                        continue
                    c = str(ch.get("c") or "")
                    if not c:
                        continue
                    if _char_is_music_glyph(ord(c[0])):
                        continue
                    n += 1
    return n


def _save_pymupdf_document(doc, opened_path: str, out_path: str) -> None:
    import os

    abs_in = os.path.abspath(opened_path)
    abs_out = os.path.abspath(out_path)
    if abs_in == abs_out:
        tmp = opened_path + ".mask-tmp.pdf"
        doc.save(tmp, deflate=True, garbage=3)
        doc.close()
        os.replace(tmp, opened_path)
    else:
        doc.save(out_path, deflate=True, garbage=3)
        doc.close()


def mask_bbox_text_regions(
    pdf_path: str,
    regions: list[dict[str, Any]],
    *,
    pad_pt: float = 2.5,
    output_path: str | None = None,
) -> int:
    """
    제목 등 지정 bbox 안의 남은 텍스트 글림을 PyMuPDF로 제거합니다.
    pikepdf 폰트 크기 strip 후 찌끄러기(같은 pt 가사·제목) 제거용.
    """
    import fitz

    if not regions:
        return 0
    out_path = output_path or pdf_path
    doc = fitz.open(pdf_path)
    redacts_total = 0
    try:
        flags = int(getattr(fitz, "TEXT_ACCURATE_BBOXES", 0) or 0)
        flags |= int(getattr(fitz, "TEXT_ACCURATE_SIDE_BEARINGS", 0) or 0)
        flags |= int(getattr(fitz, "TEXT_ACCURATE_ASCENDERS", 0) or 0)
        for reg in regions:
            try:
                page_idx = int(reg.get("page", 1)) - 1
            except (TypeError, ValueError):
                continue
            bbox = reg.get("bbox")
            if not isinstance(bbox, (list, tuple)) or len(bbox) < 4:
                continue
            if page_idx < 0 or page_idx >= len(doc):
                continue
            page = doc[page_idx]
            rect = fitz.Rect(
                float(bbox[0]),
                float(bbox[1]),
                float(bbox[2]),
                float(bbox[3]),
            ).normalize()
            if pad_pt:
                rect = fitz.Rect(
                    rect.x0 - pad_pt,
                    rect.y0 - pad_pt,
                    rect.x1 + pad_pt,
                    rect.y1 + pad_pt,
                ).normalize()
            pr = fitz.Rect(page.rect).normalize()
            clip = (rect & pr).normalize()
            if clip.is_empty:
                continue
            redacts_added = 0
            raw = page.get_text("rawdict", flags=flags)
            for block in raw.get("blocks") or []:
                if block.get("type") != 0:
                    continue
                for line in block.get("lines") or []:
                    for span in line.get("spans") or []:
                        for ch in span.get("chars") or []:
                            cb = fitz.Rect(ch.get("bbox") or [0, 0, 0, 0]).normalize()
                            if (clip & cb).is_empty:
                                continue
                            c = str(ch.get("c") or "")
                            if not c:
                                continue
                            cp = ord(c[0])
                            if _char_is_music_glyph(cp):
                                continue
                            page.add_redact_annot(
                                cb,
                                text=" ",
                                fontname="helv",
                                fontsize=max(4.0, float(span.get("size") or 10)),
                                align=0,
                                fill=False,
                                text_color=(0, 0, 0),
                                cross_out=False,
                            )
                            redacts_added += 1
            if redacts_added > 0 and _apply_page_redactions(page):
                redacts_total += redacts_added
            remaining = _count_text_chars_in_rect(page, clip, flags)
            if remaining > 0 or redacts_added == 0:
                page.add_redact_annot(clip, fill=(1, 1, 1))
                if _apply_page_redactions(page, remove_line_art=True):
                    redacts_total += max(1, remaining or 1)
        _save_pymupdf_document(doc, pdf_path, out_path)
    except Exception:
        doc.close()
        raise
    return redacts_total


def apply_score_title_mask(
    pdf_path: str,
    score_title: dict[str, Any] | None,
    *,
    pad_pt: float = 2.5,
) -> int:
    if not score_title or score_title.get("mask") is False:
        return 0
    bbox = score_title.get("bbox")
    if not isinstance(bbox, (list, tuple)) or len(bbox) < 4:
        return 0
    page = int(score_title.get("page") or 1)
    return mask_bbox_text_regions(
        pdf_path,
        [{"page": page, "bbox": list(bbox)}],
        pad_pt=pad_pt,
    )


def cmd_detect_title(args: argparse.Namespace) -> int:
    candidate = detect_title_candidate(args.extracted_json)
    json.dump(candidate or {}, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


def cmd_detect_title_pdf(args: argparse.Namespace) -> int:
    candidate = detect_title_candidate_from_pdf(args.input_pdf)
    json.dump(candidate or {}, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


def cmd_mask_title(args: argparse.Namespace) -> int:
    with open(args.regions_json, "r", encoding="utf-8") as f:
        payload = json.load(f)
    if isinstance(payload, dict) and isinstance(payload.get("bbox"), (list, tuple)):
        regions = [payload]
    elif isinstance(payload, dict) and isinstance(payload.get("regions"), list):
        regions = payload["regions"]
    elif isinstance(payload, list):
        regions = payload
    else:
        print("regions JSON은 scoreTitle 객체, {regions:[…]} 또는 배열이어야 합니다.", file=sys.stderr)
        return 1
    n = mask_bbox_text_regions(
        args.input_pdf,
        regions,
        pad_pt=float(args.pad_pt),
        output_path=args.output_pdf or args.input_pdf,
    )
    print(f"[mask-title] {n} glyph redactions", file=sys.stderr)
    return 0


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
        replace_triplet_pua=bool(getattr(args, "replace_triplet_pua", False)),
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
        replace_triplet_pua=bool(getattr(args, "replace_triplet_pua", False)),
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
        "--replace-triplet-pua",
        action="store_true",
        help="U+F073 세잇단 PUA→'3' 치환(기본 끔 — PyMuPDF 재저장 시 음표 머리 손실 위험)",
    )
    p_strip.set_defaults(func=cmd_strip)

    p_analyze = sub.add_parser("analyze", help="extracted JSON에서 폰트 크기 통계(JSON stdout)")
    p_analyze.add_argument("extracted_json")
    p_analyze.set_defaults(func=cmd_analyze)

    p_detect_title = sub.add_parser("detect-title", help="1페이지 상단 제목 후보(JSON stdout)")
    p_detect_title.add_argument("extracted_json")
    p_detect_title.set_defaults(func=cmd_detect_title)

    p_detect_title_pdf = sub.add_parser("detect-title-pdf", help="PDF에서 PyMuPDF로 제목 bbox(JSON stdout)")
    p_detect_title_pdf.add_argument("input_pdf")
    p_detect_title_pdf.set_defaults(func=cmd_detect_title_pdf)

    p_mask_title = sub.add_parser("mask-title", help="지정 bbox 텍스트 글림 제거(PyMuPDF)")
    p_mask_title.add_argument("input_pdf")
    p_mask_title.add_argument("regions_json", help="scoreTitle 객체 또는 regions 배열 JSON")
    p_mask_title.add_argument("output_pdf", nargs="?", help="생략 시 input_pdf 덮어쓰기")
    p_mask_title.add_argument("--pad-pt", type=float, default=2.5)
    p_mask_title.set_defaults(func=cmd_mask_title)

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
