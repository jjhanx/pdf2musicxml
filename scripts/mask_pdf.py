import os
import sys
import json
import unicodedata

import fitz

# PyMuPDF 리독: 선택한 사각형과 MuPDF가 잡은 “글자 bbox”가 겹치면 해당 텍스트를 제거할 수 있습니다.
# 가사(lyrics) 글림별 처리: 기본은 **흰 박스 fill 없이**(fill=False) **공백 치환**으로 글림만 빼려 시도함.
# 예전처럼 add_redact_annot(rect) 단독 호출 시 MuPDF 기본 흰 fill이 오선 같은 **벡터 위를 덮어**
# 비텍스트 음표가 “사라진 것처럼” 보일 수 있어, 선택 가사 경로에서는 이를 피함.
# 음표·SMuFL **텍스트** 글림 bbox와 만나는 가사 후보는 그대로 살려 두면 일부 가사가 남을 수 있음
# (복사 가능한 레이어만 대상 · 이미지 가사 불가는 동일).
# 그 외(title 등): bbox 흰 박스 또는 (옵션) 리덕 — 가사 선택 경로와 별개.
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
    if cat == "Nl":
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


def _pdf_color_int_to_rgb(color) -> tuple[float, float, float]:
    c = int(color or 0)
    return ((c >> 16) / 255.0, ((c >> 8) & 0xFF) / 255.0, (c & 0xFF) / 255.0)


def _replacement_blank_glyph() -> str:
    raw = os.environ.get("MASK_PDF_LYRIC_REPLACE_CHAR")
    if raw is None:
        return " "
    stripped = raw.strip()
    return stripped[:1] if stripped else " "


def _redact_fontname_candidates(span_font: str | None) -> list[str | None]:
    """리덕 치환용 폰트: 임베드 이름이 깨지면 china-s · helv · 기본 순으로 재시도."""
    out: list[str | None] = []
    seen: set[str | None] = set()

    def push(x: str | None) -> None:
        if x in seen:
            return
        seen.add(x)
        out.append(x)

    if span_font:
        tail = span_font.split("+")[-1].strip()
        if tail:
            push(tail[:64])
            simple = "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in tail)[:48]
            if simple:
                push(simple)

    push("china-s")
    push("helv")
    push(None)
    return out


def _add_lyric_glyph_redaction(
    page: fitz.Page,
    rect: fitz.Rect,
    *,
    fontsize: float,
    span_font: str | None,
    rgb: tuple[float, float, float],
    plain_old_white_fill: bool,
    replacement_glyph: str,
) -> None:
    """
    선택 가사 1글자 리덕. plain_old_white_fill 이면 예전처럼 add_redact_annot(rect) 단독(흰 fill 기본값).
    """
    r = rect.normalize()
    if r.is_empty:
        return

    tac = getattr(fitz, "TEXT_ALIGN_CENTER", 1)
    fs = float(max(fontsize, 4.0))

    if plain_old_white_fill:
        page.add_redact_annot(r)
        return

    blob = (replacement_glyph or " ")[:1]
    exc: Exception | None = None
    for fname in _redact_fontname_candidates(span_font):
        try:
            if fname is None:
                page.add_redact_annot(
                    r,
                    text=blob,
                    fontsize=fs,
                    align=tac,
                    fill=False,
                    text_color=rgb,
                    cross_out=False,
                )
            else:
                page.add_redact_annot(
                    r,
                    text=blob,
                    fontname=fname,
                    fontsize=fs,
                    align=tac,
                    fill=False,
                    text_color=rgb,
                    cross_out=False,
                )
            return
        except Exception as e:
            exc = e
            continue

    try:
        page.add_redact_annot(r, fill=False)
        return
    except Exception:
        if exc:
            raise exc
        raise


# (rect, fontsize, span_font_raw, pdf_color_int) — 선택 가사 1글자.
LyricGlyph = tuple[fitz.Rect, float, str | None, int]


def _collect_lyric_glyphs_and_music_rects(
    page: fitz.Page,
    clip: fitz.Rect,
    lyric_pad_pt: float,
    music_pad_pt: float,
) -> tuple[list[LyricGlyph], list[fitz.Rect]]:
    """rawdict 한 번으로 가사 글림(메타 포함)·음표 후보 텍스트 글림 bbox."""
    lyric_glyphs: list[LyricGlyph] = []
    music_rects: list[fitz.Rect] = []
    td = _rawdict_clip(page, clip)
    for block in td.get("blocks") or []:
        if block.get("type") != 0:
            continue
        for line in block.get("lines") or []:
            for sp in line.get("spans") or []:
                fsize = float(sp.get("size") or 10)
                sfont = sp.get("font")
                pdf_color_i = sp.get("color")
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
                            rx = _rect_expand(r, lyric_pad_pt).normalize()
                            if not rx.is_empty:
                                lyric_glyphs.append((rx, fsize, sfont, pdf_color_i if pdf_color_i is not None else 0))
                else:
                    txt = sp.get("text") or ""
                    bb = sp.get("bbox")
                    if not bb or not txt.strip():
                        continue
                    sx0, sy0, sx1, sy1 = bb
                    dw = max((sx1 - sx0) / len(txt), 0.001)
                    pdf_color_i = sp.get("color")
                    if pdf_color_i is None:
                        pdf_color_i = 0
                    for i, cu in enumerate(txt):
                        cr = fitz.Rect(sx0 + i * dw, sy0, sx0 + (i + 1) * dw, sy1).normalize()
                        if cr.is_empty:
                            continue
                        cp = ord(cu)
                        if _char_is_music_glyph(cp):
                            music_rects.append(_rect_expand(cr, music_pad_pt))
                            continue
                        if _char_strip_as_lyric_overlay(cu):
                            rx = _rect_expand(cr, lyric_pad_pt).normalize()
                            if not rx.is_empty:
                                lyric_glyphs.append((rx, fsize, sfont, pdf_color_i))


def _lyric_glyphs_skip_music_overlap(items: list[LyricGlyph], music_rects: list[fitz.Rect]) -> list[LyricGlyph]:
    if not items or not music_rects:
        return list(items)
    out: list[LyricGlyph] = []
    for r, fs, sf, ci in items:
        if r.normalize().is_empty:
            continue
        if any(r.intersects(m) for m in music_rects):
            continue
        out.append((r, fs, sf, ci))
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
        lyric_glyphs_by_page: dict[int, list[LyricGlyph]] = {}

        lyric_plain_redact_white = _env_truthy("MASK_PDF_LYRIC_PLAIN_REDACT")
        lyric_blank_glyph = _replacement_blank_glyph()

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
                lyric_glyphs, music_rects = _collect_lyric_glyphs_and_music_rects(page, scan, lyric_pad, music_pad)
                if music_safe_overlap and music_rects:
                    lyric_glyphs = _lyric_glyphs_skip_music_overlap(lyric_glyphs, music_rects)
                if lyric_glyphs:
                    lyric_glyphs_by_page.setdefault(page_idx, []).extend(lyric_glyphs)
                    continue
                if lyric_white_fallback:
                    white_rects.setdefault(page_idx, []).append(rect)
                continue

            if use_text_redact and _rect_has_vector_text(page, rect):
                redact_rects.setdefault(page_idx, []).append(rect)
            else:
                white_rects.setdefault(page_idx, []).append(rect)

        pages_with_redact = sorted(set(redact_rects.keys()) | set(lyric_glyphs_by_page.keys()))
        for page_idx in pages_with_redact:
            page = doc[page_idx]
            for r2, fsize, span_font, color_i in lyric_glyphs_by_page.get(page_idx, []):
                _add_lyric_glyph_redaction(
                    page,
                    r2,
                    fontsize=fsize,
                    span_font=span_font,
                    rgb=_pdf_color_int_to_rgb(color_i),
                    plain_old_white_fill=lyric_plain_redact_white,
                    replacement_glyph=lyric_blank_glyph,
                )
            for r in redact_rects.get(page_idx, []):
                page.add_redact_annot(r)

            rects_fallback = redact_rects.get(page_idx, []) or []

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
                lyric_fb = lyric_glyphs_by_page.get(page_idx, [])
                for r2, _fs, _sf, _ci in lyric_fb:
                    page.draw_rect(r2, color=(1, 1, 1), fill=(1, 1, 1))
                for r in rects_fallback:
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
