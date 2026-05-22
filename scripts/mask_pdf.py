import os
import sys
import json
import unicodedata

import fitz

# PyMuPDF 리독: 선택한 사각형과 MuPDF가 잡은 “글자 bbox”가 겹치면 그 글림을 제거합니다(텍스트 연산 한정).
# 그래서 가사 줄의 높은 line-box·패딩이 오선 글림과 만나면 음표 텍스트까지 지워질 수 있음 → 글림 높이는
# 음표·SMuFL 글림과 겹치는 가사 후보는 리덕에서 빼서, 음표 텍스트 글림이 같이 지워지지 않게 함.
# 가사 블록(lyrics): L/Nd/Zs/P/하이픈만 타깃, SMuFL·뮤지컬 블록은 스킵. 그 외(title 등): bbox 흰 박스 또는 (옵션) 리독.
_PDF_REDACT_IMAGE_NONE = getattr(fitz, "PDF_REDACT_IMAGE_NONE", 0)
_PDF_REDACT_LINE_ART_NONE = getattr(fitz, "PDF_REDACT_LINE_ART_NONE", 0)
_PDF_REDACT_TEXT_REMOVE = getattr(fitz, "PDF_REDACT_TEXT_REMOVE", 0)

_TEXT_RAWDICT_FLAGS = int(getattr(fitz, "TEXT_ACCURATE_BBOXES", 0) or 0)


def _env_truthy(name: str) -> bool:
    v = os.environ.get(name, "").strip().lower()
    return v in ("1", "true", "yes", "on")


def _env_falsy(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("0", "false", "no", "off")


def _char_is_music_glyph(cp: int) -> bool:
    """PDF 악보에 흔한 음표·잇단·SMuFL — 가사 선택 제거에서는 항상 보존."""
    if 0xE000 <= cp <= 0xF8FF:
        return True
    if 0x1D100 <= cp <= 0x1D1FF:
        return True
    if cp in (0x2669, 0x266A, 0x266B, 0x266C):
        return True
    if 0xF0000 <= cp <= 0xFFFFD or 0x100000 <= cp <= 0x10FFFD:
        return True
    return False


# 검토 가사 블록에서 제거 허용: 글자·숫자·공백 + 하이픈 계열뿐이라는 규칙에 맞게,
# 허용되지 않는 부호들(쉼표·마침표·인용 등)도 같이 치웁니다(P*).
HYPHENS = frozenset(
    ("-", "\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2212", "\ufe63", "\uff0d")
)


def _char_strip_as_lyric_overlay(ch: str) -> bool:
    """
    True면 해당 글자를 마스킹(리독) 대상으로 함.
    음표·음악 기호 블록은 어떤 범주에 있어도 False.
    """
    if len(ch) != 1:
        return False
    cp = ord(ch)
    if _char_is_music_glyph(cp):
        return False
    if ch in HYPHENS:
        return True
    cat = unicodedata.category(ch)
    if cat[0] == "L":
        return True
    if cat == "Nd":
        return True
    if cat == "Zs":
        return True
    if cat.startswith("P"):
        return True
    return False


def _rect_expand(r: fitz.Rect, pad: float) -> fitz.Rect:
    rr = fitz.Rect(r).normalize()
    if rr.is_empty:
        return rr
    return fitz.Rect(rr.x0 - pad, rr.y0 - pad, rr.x1 + pad, rr.y1 + pad).normalize()


def _clip_vertical_grow_into_page(rect: fitz.Rect, page: fitz.Page, pad_pt: float) -> fitz.Rect:
    """가사 블록 위아래 오선까지 음표 텍스트를 집계하려 세로 확장 후 페이지 경계로 자른 clip."""
    b = rect.normalize()
    if b.is_empty:
        return b
    pr = fitz.Rect(page.rect).normalize()
    y0 = max(pr.y0, b.y0 - pad_pt)
    y1 = min(pr.y1, b.y1 + pad_pt)
    ex = fitz.Rect(b.x0, y0, b.x1, y1).normalize()
    if ex.is_empty or ex.y1 <= ex.y0:
        return b
    inter = pr & ex
    return inter.normalize() if not inter.is_empty else ex


def _rawdict_clip(page: fitz.Page, clip: fitz.Rect) -> dict:
    c = clip.normalize()
    if c.is_empty:
        return {}
    try:
        return page.get_text("rawdict", clip=c, flags=_TEXT_RAWDICT_FLAGS)
    except TypeError:
        try:
            return page.get_text("rawdict", clip=c)
        except Exception:
            return {}
    except Exception:
        return {}


def _collect_lyrics_and_music_glyph_rects(
    page: fitz.Page,
    clip: fitz.Rect,
    lyric_pad_pt: float,
    music_pad_pt: float,
) -> tuple[list[fitz.Rect], list[fitz.Rect]]:
    """rawdict 한 번으로 가사·음표 후보 글림 bbox 각각 모은다."""
    lyric_rects: list[fitz.Rect] = []
    music_rects: list[fitz.Rect] = []
    td = _rawdict_clip(page, clip)
    for block in td.get("blocks") or []:
        if block.get("type") != 0:
            continue
        for line in block.get("lines") or []:
            for sp in line.get("spans") or []:
                chars = sp.get("chars") or []
                if chars:
                    for ch in chars:
                        s = ch.get("c") or ""
                        bb = ch.get("bbox")
                        if not bb or len(s) != 1:
                            continue
                        r = fitz.Rect(bb).normalize()
                        if r.is_empty:
                            continue
                        cp = ord(s)
                        if _char_is_music_glyph(cp):
                            music_rects.append(_rect_expand(r, music_pad_pt))
                            continue
                        if _char_strip_as_lyric_overlay(s):
                            lyric_rects.append(_rect_expand(r, lyric_pad_pt))
                else:
                    txt = sp.get("text") or ""
                    bb = sp.get("bbox")
                    if not bb or not txt.strip():
                        continue
                    sx0, sy0, sx1, sy1 = bb
                    dw = max((sx1 - sx0) / len(txt), 0.001)
                    for i, cu in enumerate(txt):
                        r = fitz.Rect(sx0 + i * dw, sy0, sx0 + (i + 1) * dw, sy1).normalize()
                        if r.is_empty:
                            continue
                        cp = ord(cu)
                        if _char_is_music_glyph(cp):
                            music_rects.append(_rect_expand(r, music_pad_pt))
                            continue
                        if _char_strip_as_lyric_overlay(cu):
                            lyric_rects.append(_rect_expand(r, lyric_pad_pt))
    return lyric_rects, music_rects


def _lyric_redacts_skip_music_overlap(lyric_rects: list[fitz.Rect], music_rects: list[fitz.Rect]) -> list[fitz.Rect]:
    """리덕 직후 음표 텍스트가 같이 증발하는 경우를 줄이기: 음표 글림과 겹치는 가사 리덕 후보 제거."""
    if not lyric_rects or not music_rects:
        return list(lyric_rects)
    out: list[fitz.Rect] = []
    for r in lyric_rects:
        if r.normalize().is_empty:
            continue
        if any(r.intersects(m) for m in music_rects):
            continue
        out.append(r)
    return out


def _rect_has_vector_text(page: fitz.Page, rect: fitz.Rect) -> bool:
    r = rect.normalize()
    if r.is_empty:
        return False
    try:
        td = page.get_text("dict", clip=r)
    except Exception:
        return False
    for b in td.get("blocks") or []:
        if b.get("type") == 0:
            return True
    return False


def mask_pdf(pdf_in, pdf_out, json_path):
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    prev_glyph_h = fitz.TOOLS.set_small_glyph_heights(None)
    fitz.TOOLS.set_small_glyph_heights(True)

    doc = fitz.open(pdf_in)
    try:
        use_text_redact = _env_truthy("MASK_PDF_TEXT_REDACT")
        lyric_selective = not _env_falsy("MASK_PDF_LYRIC_SELECTIVE")
        music_safe_overlap = not _env_falsy("MASK_PDF_LYRIC_MUSIC_SAFE")
        lyric_white_fallback = _env_truthy("MASK_PDF_LYRIC_WHITE_FALLBACK")
        try:
            lyric_pad = float(os.environ.get("MASK_PDF_LYRIC_CHAR_PAD_PT", "0") or 0)
        except ValueError:
            lyric_pad = 0
        try:
            music_pad = float(os.environ.get("MASK_PDF_LYRIC_MUSIC_PAD_PT", "0.35") or 0.35)
        except ValueError:
            music_pad = 0.35
        try:
            staff_scan = float(os.environ.get("MASK_PDF_LYRIC_STAFF_SCAN_PAD_PT", "40") or 40)
        except ValueError:
            staff_scan = 40

        mask_types = {"title", "composer", "lyricist", "copyright", "lyrics", "tempo"}

        redact_rects: dict[int, list[fitz.Rect]] = {}
        white_rects: dict[int, list[fitz.Rect]] = {}

        for item in data:
            item_type = item.get("type", "unknown")
            if item_type not in mask_types:
                continue
            page_idx = item.get("page", 1) - 1
            bbox = item.get("bbox")
            if not bbox or not (0 <= page_idx < len(doc)):
                continue
            page = doc[page_idx]
            rect = fitz.Rect(bbox).normalize()
            if rect.is_empty:
                continue

            is_lyrics = item_type == "lyrics"
            if is_lyrics and lyric_selective and _rect_has_vector_text(page, rect):
                scan = _clip_vertical_grow_into_page(rect, page, staff_scan)
                lyric_rects, music_rects = _collect_lyrics_and_music_glyph_rects(page, scan, lyric_pad, music_pad)
                if music_safe_overlap and music_rects:
                    lyric_rects = _lyric_redacts_skip_music_overlap(lyric_rects, music_rects)
                if lyric_rects:
                    redact_rects.setdefault(page_idx, []).extend(lyric_rects)
                    continue
                if lyric_white_fallback:
                    white_rects.setdefault(page_idx, []).append(rect)
                continue

            if use_text_redact and _rect_has_vector_text(page, rect):
                redact_rects.setdefault(page_idx, []).append(rect)
            else:
                white_rects.setdefault(page_idx, []).append(rect)

        for page_idx, rects in redact_rects.items():
            page = doc[page_idx]
            for r in rects:
                page.add_redact_annot(r)
            try:
                page.apply_redactions(
                    images=_PDF_REDACT_IMAGE_NONE,
                    graphics=_PDF_REDACT_LINE_ART_NONE,
                    text=_PDF_REDACT_TEXT_REMOVE,
                )
            except TypeError:
                for annot in list(page.annots() or []):
                    if annot.type[1] == "Redact":
                        page.delete_annot(annot)
                for r in rects:
                    page.draw_rect(r, color=(1, 1, 1), fill=(1, 1, 1))

        for page_idx, rects in white_rects.items():
            page = doc[page_idx]
            for r in rects:
                page.draw_rect(r, color=(1, 1, 1), fill=(1, 1, 1))

        doc.save(pdf_out)
    finally:
        doc.close()
        fitz.TOOLS.set_small_glyph_heights(prev_glyph_h)


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python mask_pdf.py <pdf_in> <pdf_out> <json_path>")
        sys.exit(1)
    mask_pdf(sys.argv[1], sys.argv[2], sys.argv[3])
