import os
import re
import sys
import json
import unicodedata

import fitz

# extract_text.py와 동일: SMuFL 등 PUA는 가사 좌표 매칭에서 제외(시각 기호는 건드리지 않음).
_PUA_CHARS_RE = re.compile(
    r"[\uE000-\uF8FF\U000F0000-\U000FFFFF\U00100000-\U0010FFFF]",
    flags=re.UNICODE,
)


def _strip_pua_chars(s: str) -> str:
    return _PUA_CHARS_RE.sub("", s or "")

# PyMuPDF 리덕으로 텍스트를 지웁니다. 선택 **가사** 는:
# • `rawdict` 플래그(기본: ACCURATE_BBOXES + SIDE_BEARINGS + ASCENDERS)로 과대 bbox를 줄입니다.
# • **`fill=False` + 블랭크 치환**: 벡터 fill 없이 표시 문자를 공백 등으로 두는 동작입니다.
# (PDF 콘텐츠 스트림에서 CID 하나만 교체하는 것과는 다르고, 여전히 리덕 **사각형**과 겹치면 그 영역 안의 표시 문자가 같이 빠질 수 있습니다.)
# 리덕 사각형 최소 높이 보강은 **위로 패딩하지 않고**(아래로만).
# **`MASK_PDF_LYRIC_REDACT_MAX_HEIGHT_EM`** 로 **세로 상한**(글자 줄 폰트 크기 근처)을 두어, 과대 세로 bbox가
# 한 줄 아래 성부까지 뻗으며 머리를 깎거나, 역으로 **위 줄 가사 bbox**가 더 아래 오선까지 내려와 겹치는 현상을 줄입니다.
# `add_redact_annot(rect)` 만(기본 흰 fill) 쓰면 오선 등 벡터가 칠해져 음표가 사라진 것처럼 보일 수 있습니다.
#
# 음표·SMuFL **텍스트 글림**과 가사의 **면적 비율**로 리덕 생략 여부를 정합니다(`MASK_PDF_LYRIC_MUSIC_MIN_OVERLAP`).
# **한글(완성형·호환 자모)** 은 교착 잔류를 줄이려 기본적으로 이 검사를 건너뜁니다(`MASK_PDF_LYRIC_IGNORE_MUSIC_OVERLAP_FOR_KOREAN`).
# 예전처럼 **교차만**으로 보호하면 `MASK_PDF_LYRIC_MUSIC_LEGACY_INTERSECT`.
# 그 외(title 등): bbox 흰색 사각형 또는 (선택) 리덕.
# 검토 원문은 JSON에 두고 Audiveris용 마스킹만 맞출 때는 **`MASK_PDF_GLOBAL_HANGUL_SYLLABLE_BLANK` 기본 켜짐**(`=0`으로 끔)으로
# 페이지 전체 한글(완성형·자모·호환 자모) 텍스트를 추가 블랭크해 박스 누락 잔류를 줄입니다(SMuFL 제외).
#
# **`extract_text.py`가 넣어 둔 `spans[].bbox`(dict span 단위)** 가 있으면 기본적으로 그 좌표만으로 가사 후보 글림을 만들고,
# 페이지 전체를 다시 긁어 과대 bbox를 잡지 않습니다(`MASK_PDF_LYRIC_USE_EXTRACT_SPANS=0`이면 종전처럼 rawdict 재수집).

_PDF_REDACT_IMAGE_NONE = getattr(fitz, "PDF_REDACT_IMAGE_NONE", 0)
_PDF_REDACT_LINE_ART_NONE = getattr(fitz, "PDF_REDACT_LINE_ART_NONE", 0)
_PDF_REDACT_TEXT_REMOVE = getattr(fitz, "PDF_REDACT_TEXT_REMOVE", 0)


def _effective_rawdict_flags() -> int:
    """
    선택 가사/음표 분류용 `get_text('rawdict', flags=…)`.

    환경 `MASK_PDF_LYRIC_TEXT_FLAGS` 에 정수(hex `0x` 가능)가 있으면 그대로 사용.
    없으면 ACCURATE_BBOXES | SIDE_BEARINGS | ASCENDERS (있는 항목만 OR).
    """
    raw = os.environ.get("MASK_PDF_LYRIC_TEXT_FLAGS", "").strip()
    if raw:
        try:
            return int(raw, 0)
        except ValueError:
            pass
    f = int(getattr(fitz, "TEXT_ACCURATE_BBOXES", 0) or 0)
    f |= int(getattr(fitz, "TEXT_ACCURATE_SIDE_BEARINGS", 0) or 0)
    f |= int(getattr(fitz, "TEXT_ACCURATE_ASCENDERS", 0) or 0)
    return f


def _env_truthy(name: str) -> bool:
    v = os.environ.get(name, "").strip().lower()
    return v in ("1", "true", "yes", "on")


def _env_falsy(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("0", "false", "no", "off")


def _apply_page_redactions(page: fitz.Page) -> bool:
    """
    PyMuPDF `Page.apply_redactions` 기본 인자값이 images=PIXELS(2), graphics=IF_COVERED(1), text=REMOVE(0) 입니다.

    kwargs를 부분만 넘기면 graphics/images가 위 기본으로 남아 **리덕 사각형과 맞닿은 오선·벡터 음표**가 깎일 수 있습니다.
    성공 가능한 모든 경로에서 **항상 images·graphics·text를 세트로 고정**(벡터/이미지 무시·텍스트만 리덕)합니다.
    """
    img = int(_PDF_REDACT_IMAGE_NONE)
    gra = int(_PDF_REDACT_LINE_ART_NONE)
    txt = int(_PDF_REDACT_TEXT_REMOVE)
    safe_kw: dict[str, int] = {"images": img, "graphics": gra, "text": txt}
    try:
        page.apply_redactions(**safe_kw)
        return True
    except TypeError:
        pass
    except ValueError:
        pass
    # 구버전: 키워드 미지원이면 순서대로 images, graphics, text.
    try:
        page.apply_redactions(img, gra, txt)
        return True
    except TypeError:
        pass
    except ValueError:
        pass
    return False


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


def _is_hangul_syllable(cp: int) -> bool:
    """한글 완성형 음절(U+AC00–U+D7A3). 검토 블록 밖 잔류 가사·제목 문자 제거 안전망으로 사용."""
    return 0xAC00 <= cp <= 0xD7A3


def _is_korean_overlay_glyph(cp: int) -> bool:
    """글자 선택 마스킹에서 자주 등장하는 한글 블록(완성형·현대 자모·호환 자모)."""
    if _is_hangul_syllable(cp):
        return True
    if 0x1100 <= cp <= 0x11FF:  # Hangul Jamo (조합형·자모)
        return True
    if 0x3131 <= cp <= 0x318E:  # Hangul Compatibility Jamo
        return True
    return False


# 검토 가사 블록에서 제거 허용: 글자·숫자·공백 + 하이픈 계열뿐이라는 규칙에 맞게,
# 허용되지 않는 부호들(쉼표·마침표·인용 등)도 같이 치웁니다(P*).
HYPHENS = frozenset(
    ("-", "\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2212", "\ufe63", "\uff0d")
)

# 메트로놈/템포 줄 근처가 가사 블록에 포함되면 `=` 등이 마스킹 대상(P*)이 되어
# 동일 줄 SMuFL(♩ 등)·인접 수치와 같은 bbox에서 리덕이 넓게 먹는 부작용이 있어 보존.
LYRIC_TEMPO_CHARS_NEVER_STRIP = frozenset("=")


def _char_strip_as_lyric_overlay(ch: str) -> bool:
    """
    True면 해당 글자를 마스킹(리독) 대상으로 함.
    음표·음악 기호 블록은 어떤 범주에 있어도 False.
    """
    if len(ch) != 1:
        return False
    if ch in LYRIC_TEMPO_CHARS_NEVER_STRIP:
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
    if cat == "No":
        return True  # 다른 숫자(원문자 숫자·분수표기 등 일부 OCR)
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


def _rawdict_clip(page: fitz.Page, clip: fitz.Rect, flags: int) -> dict:
    c = clip.normalize()
    if c.is_empty:
        return {}
    try:
        return page.get_text("rawdict", clip=c, flags=flags)
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


def _lyric_redact_rect_min_height(r: fitz.Rect, min_h_pt: float) -> fitz.Rect:
    """
    CID/세로폭이 극히 작은 글림은 리덕 박스가 얇아 엔진이 한 겹만 지우는 경우가 있습니다.

    **`y0` 를 줄이며 위로 늘리지 않음** — 위로 패딩하면 오선·음표머리·온쉼표(SMuFL 텍스트)와 겹친
    리덕에 같이 들어가 머리까지 지워지는 현상이 납니다.
    """
    if min_h_pt <= 0:
        return r.normalize()
    rr = r.normalize()
    if rr.is_empty:
        return rr
    h = rr.height
    if h >= min_h_pt:
        return rr
    deficit = min_h_pt - h
    return fitz.Rect(rr.x0, rr.y0, rr.x1, rr.y1 + deficit).normalize()


def _clamp_lyric_redact_vertical_to_font_centered(
    redact_rect: fitz.Rect,
    overlap_rect: fitz.Rect,
    fontsize: float,
    *,
    max_height_em: float,
) -> fitz.Rect:
    """
    rawdict 세로 bbox가 과도하게 길면(위아래 줄·오선으로 뻗음) 같은 리덕에 인접 스태프 머리가 들어갈 수 있습니다.
    **세로를 폰트×max_height_em 로 상한**하고, **세로 중심은 가능하면 tight overlap_rect 중앙**(실제 글림 근처)에 둔 뒤
    redact_rect 세로 구간 안에 맞춥니다(패딩은 좁히지 않고 **세로만** 줄임).

    max_height_em≤0 이면 생략.
    """
    rr = redact_rect.normalize()
    if rr.is_empty:
        return rr
    mh = float(max_height_em)
    if mh <= 1e-6:
        return rr
    fs = max(float(fontsize), 6.0)
    cap_h = fs * mh
    if rr.height <= cap_h + 1e-9:
        return rr

    nh = cap_h
    ov = overlap_rect.normalize()
    if not ov.is_empty:
        cy = 0.5 * (ov.y0 + ov.y1)
        if cy < rr.y0:
            cy = rr.y0
        elif cy > rr.y1:
            cy = rr.y1
    else:
        cy = 0.5 * (rr.y0 + rr.y1)

    y0n = cy - nh * 0.5
    y1n = cy + nh * 0.5
    if y0n < rr.y0:
        d = rr.y0 - y0n
        y0n += d
        y1n += d
    if y1n > rr.y1:
        d = y1n - rr.y1
        y0n -= d
        y1n -= d
    y0n = max(y0n, rr.y0)
    y1n = min(y1n, rr.y1)
    if y1n <= y0n + 1e-6:
        return rr
    return fitz.Rect(rr.x0, y0n, rr.x1, y1n).normalize()


def _keep_bottom_fraction_rect(redact_rect: fitz.Rect, keep_frac: float) -> fitz.Rect:
    """세로로 긴 리덕 박스의 **위쪽**을 줄이고 **아래 keep_frac 높이**만 남깁니다(빈 교차 또는 비정규면 무시)."""
    rr = redact_rect.normalize()
    if rr.is_empty:
        return rr
    f = float(keep_frac)
    if not (f > 0.0 and f < 1.0):
        return rr
    h = rr.height
    if h <= 1e-6:
        return rr
    y_cut = rr.y1 - f * h
    if rr.y1 - y_cut < max(0.02, min(0.12, h * 0.06)):
        return rr
    return fitz.Rect(rr.x0, y_cut, rr.x1, rr.y1).normalize()


def _finalize_lyric_redact_glyph_rect(
    overlap_rect: fitz.Rect,
    redact_rect: fitz.Rect,
    fontsize: float,
    gh: str,
    min_h_pt: float,
    *,
    max_height_em: float,
    korean_bottom_keep_frac: float,
) -> fitz.Rect:
    """overlap 중심·폰트 em 기준 세로 상한 후, 선택적 한글 하단 비율, 마지막으로 최소 높이(아래로만)."""
    r = redact_rect.normalize()
    if r.is_empty:
        return r
    r = _clamp_lyric_redact_vertical_to_font_centered(
        r, overlap_rect, fontsize, max_height_em=max_height_em
    )
    ch0 = (gh[:1] if gh else "") or ""
    if ch0 and _is_korean_overlay_glyph(ord(ch0)):
        r = _keep_bottom_fraction_rect(r, korean_bottom_keep_frac)
    return _lyric_redact_rect_min_height(r, min_h_pt)


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


def _rect_area(r: fitz.Rect) -> float:
    rn = r.normalize()
    if rn.is_empty:
        return 0.0
    try:
        return float(rn.get_area())
    except Exception:
        w, h = rn.width, rn.height
        return float(max(0.0, w * h))


def _lyric_overlap_den_area(r: fitz.Rect, fontsize: float) -> float:
    """
    SMALL GLYPH HEIGHTS 로 면적 la가 과소 추정되면 ia/la 가 비현실적으로 커져
    MUSIC_SAFE 가 가사를 과도하게 스킵(찌꺼기 잔류)합니다. 폰크기 기준 하한 면적으로 보정합니다.
    """
    a = max(_rect_area(r.normalize()), 1e-12)
    fs = max(float(fontsize), 6.0)
    floor_sq = fs * fs * 0.04
    return max(a, float(floor_sq))


def _lyric_blocked_by_music_rect(
    lyric: fitz.Rect,
    music: fitz.Rect,
    *,
    min_overlap_ratio: float,
    lyric_fontsize: float,
) -> bool:
    """
    가사 글림(보통 패드 없음)과 확장된 음표 글림 bbox의 겹침이 충분할 때만
    「음표까지 지울 수 있음 → 가사 리덕 생략」으로 간주한다.

    과거처럼 intersect만 보면 가로로만 스친 깃발·플래그와도 겹치는 것처럼 잡혀
    가사가 많이 남고, 반대로 리덕용으로 부풀린 bbox는 음표 머리까지 덮어버린다.

    최소값 ~0.06 = 매우 예민한 보호 ~0.30 = 깃발 수준 가로 겹침은 무시하고 가사 제거 허용.
    """
    lyr = lyric.normalize()
    mus = music.normalize()
    if lyr.is_empty or mus.is_empty:
        return False
    inter = lyr & mus
    if inter.is_empty:
        return False
    ia = _rect_area(inter)
    la_eff = _lyric_overlap_den_area(lyr, lyric_fontsize)
    ma = max(_rect_area(mus), 1e-12)
    return max(ia / la_eff, ia / ma) >= float(min_overlap_ratio)


# overlap_rect는 음표 겹침 판별용(tight bbox), redact_rect는 리덕 annot에 적용.
# 마지막 str: 해당 글자(겹침 스킵 시 한글 전용 처리 등).
LyricGlyph = tuple[fitz.Rect, fitz.Rect, float, str | None, int, str]


def _lyric_glyph_dedupe_key(g: LyricGlyph) -> tuple:
    """동일 페이지에서 중복 리덕 추가 방지용(근접 좌표·폰트·색)."""
    ov, rd, fs, sf, ci, gh = g
    r1 = ov.normalize()
    r2 = rd.normalize()

    def q(r: fitz.Rect) -> tuple[float, float, float, float]:
        return round(r.x0, 2), round(r.y0, 2), round(r.x1, 2), round(r.y1, 2)

    return (q(r1), q(r2), round(float(fs), 2), sf, int(ci or 0), gh[:1])


def _collect_lyric_glyphs_and_music_rects(
    page: fitz.Page,
    clip: fitz.Rect,
    lyric_pad_pt: float,
    music_pad_pt: float,
    rawdict_flags: int,
    *,
    korean_overlay_only: bool = False,
) -> tuple[list[LyricGlyph], list[fitz.Rect]]:
    """rawdict 한 번으로 가사 글림(메타 포함)·음표 후보 텍스트 글림 bbox."""
    lyric_glyphs: list[LyricGlyph] = []
    music_rects: list[fitz.Rect] = []
    td = _rawdict_clip(page, clip, rawdict_flags)
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
                        if korean_overlay_only and not _is_korean_overlay_glyph(cp):
                            continue
                        if _char_strip_as_lyric_overlay(s):
                            overlap_r = r.normalize()
                            rx = _rect_expand(r, lyric_pad_pt).normalize()
                            if overlap_r.is_empty:
                                continue
                            if not rx.is_empty:
                                lyric_glyphs.append(
                                    (
                                        overlap_r,
                                        rx,
                                        fsize,
                                        sfont,
                                        pdf_color_i if pdf_color_i is not None else 0,
                                        s,
                                    )
                                )
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
                        if korean_overlay_only and not _is_korean_overlay_glyph(cp):
                            continue
                        if _char_strip_as_lyric_overlay(cu):
                            overlap_cr = cr.normalize()
                            rx = _rect_expand(cr, lyric_pad_pt).normalize()
                            if overlap_cr.is_empty:
                                continue
                            if not rx.is_empty:
                                lyric_glyphs.append((overlap_cr, rx, fsize, sfont, pdf_color_i, cu))

    return lyric_glyphs, music_rects


def _lyric_glyphs_skip_music_overlap(
    items: list[LyricGlyph],
    music_rects: list[fitz.Rect],
    *,
    legacy_intersect: bool,
    min_overlap_ratio: float,
    bypass_music_overlap_for_korean_overlay: bool,
) -> list[LyricGlyph]:
    if not items or not music_rects:
        return list(items)
    out: list[LyricGlyph] = []
    mor = float(min_overlap_ratio)
    mor = max(1e-4, mor)
    for overlap_r, redact_r, fs, sf, ci, gh in items:
        rd = redact_r.normalize()
        if rd.is_empty:
            continue
        if bypass_music_overlap_for_korean_overlay and len(gh) == 1 and _is_korean_overlay_glyph(ord(gh)):
            out.append((overlap_r, rd, fs, sf, ci, gh))
            continue
        blocked = False
        for music_r in music_rects:
            if legacy_intersect:
                blocked = overlap_r.intersects(music_r)
            else:
                blocked = _lyric_blocked_by_music_rect(
                    overlap_r, music_r, min_overlap_ratio=mor, lyric_fontsize=fs
                )
            if blocked:
                break
        if blocked:
            continue
        out.append((overlap_r, rd, fs, sf, ci, gh))
    return out


def _rect_union_normalized(rects: list[fitz.Rect]) -> fitz.Rect:
    acc: fitz.Rect | None = None
    for r in rects:
        rn = r.normalize()
        if rn.is_empty:
            continue
        acc = rn if acc is None else (acc | rn)
    return acc.normalize() if acc is not None else fitz.Rect()


def _lyric_glyphs_from_extract_spans(
    spans: list,
    lyric_pad_pt: float,
) -> list[LyricGlyph]:
    """
    검토 JSON에 `extract_text.py`가 넣은 span bbox + 텍스트만 사용해 LyricGlyph를 만든다.
    (페이지 전역 rawdict 재수집 없이 추출에 쓰인 가로·세로 범위에 가깝게 붙인다.)
    """
    out: list[LyricGlyph] = []
    pad = float(max(lyric_pad_pt, 0.0))
    for sp in spans:
        if not isinstance(sp, dict):
            continue
        bb = sp.get("bbox")
        raw_t = sp.get("text")
        if (
            not bb
            or not isinstance(raw_t, str)
            or not isinstance(bb, (list, tuple))
            or len(bb) < 4
        ):
            continue
        txt = _strip_pua_chars(raw_t)
        if not txt.strip():
            continue
        sx0, sy0, sx1, sy1 = float(bb[0]), float(bb[1]), float(bb[2]), float(bb[3])
        bounds = fitz.Rect(sx0, sy0, sx1, sy1).normalize()
        if bounds.is_empty:
            continue
        h = bounds.height
        fsize = max(4.0, min(float(h), 80.0))
        sfont: str | None = None
        pdf_color_i = 0
        sx0, sy0, sx1, sy1 = bounds.x0, bounds.y0, bounds.x1, bounds.y1
        dw = max((sx1 - sx0) / max(len(txt), 1), 0.001)
        for i, cu in enumerate(txt):
            cp = ord(cu)
            if _char_is_music_glyph(cp):
                continue
            if not _char_strip_as_lyric_overlay(cu):
                continue
            cr = fitz.Rect(sx0 + i * dw, sy0, sx0 + (i + 1) * dw, sy1).normalize()
            if cr.is_empty:
                continue
            rx = _rect_expand(cr, pad).normalize()
            if rx.is_empty:
                continue
            out.append((cr, rx, fsize, sfont, pdf_color_i, cu))
    return out


def _item_has_extract_spans_for_mask(item: dict) -> bool:
    spans = item.get("spans")
    if not isinstance(spans, list) or not spans:
        return False
    for s in spans:
        if not isinstance(s, dict):
            return False
        bb = s.get("bbox")
        if not bb or not isinstance(bb, (list, tuple)) or len(bb) < 4:
            return False
        if not isinstance(s.get("text"), str):
            return False
    return True


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
        # 2026-06-10: Replace Private Use Area triplet symbol U+F073 with standard '3' to guarantee Tesseract OCR
        # recognizes it correctly and prevents it from being misrecognized as 'P' or 'p'.
        for page_idx, page in enumerate(doc):
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
                            txt = s.get("text") or ""
                            if not txt:
                                continue
                            sx0, sy0, sx1, sy1 = s["bbox"]
                            dw = (sx1 - sx0) / len(txt)
                            for i, c in enumerate(txt):
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
                _apply_page_redactions(page)

        use_text_redact = _env_truthy("MASK_PDF_TEXT_REDACT")
        lyric_selective = not _env_falsy("MASK_PDF_LYRIC_SELECTIVE")
        music_safe_overlap = not _env_falsy("MASK_PDF_LYRIC_MUSIC_SAFE")
        lyric_white_fallback = _env_truthy("MASK_PDF_LYRIC_WHITE_FALLBACK")
        try:
            lyric_pad = float(os.environ.get("MASK_PDF_LYRIC_CHAR_PAD_PT", "0") or 0)
        except ValueError:
            lyric_pad = 0
        try:
            music_pad = float(os.environ.get("MASK_PDF_LYRIC_MUSIC_PAD_PT", "0.12") or 0.12)
        except ValueError:
            music_pad = 0.12
        music_overlap_legacy_intersect = _env_truthy("MASK_PDF_LYRIC_MUSIC_LEGACY_INTERSECT")
        # 같은 가로 줄에 깔린 SMuFL·한글 글림 bbox가 과대하게 겹칠 때 MUSIC_SAFE 만으로 가사 한 글이 남습니다.
        # 기본적으로 한글(완성형·호환 자모)은 겹침 스킵을 적용하지 않고 리덕합니다. `MASK_PDF_LYRIC_IGNORE_MUSIC_OVERLAP_FOR_KOREAN=0` 으로 끕니다.
        korean_music_overlap_bypass = lyric_selective and not _env_falsy(
            "MASK_PDF_LYRIC_IGNORE_MUSIC_OVERLAP_FOR_KOREAN"
        )
        raw_mor = os.environ.get("MASK_PDF_LYRIC_MUSIC_MIN_OVERLAP", "").strip()
        if raw_mor:
            try:
                music_overlap_min = float(raw_mor)
            except ValueError:
                music_overlap_min = 0.09
        else:
            music_overlap_min = 0.09
        music_overlap_min = max(1e-4, min(0.95, music_overlap_min))
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
        rawdict_flags = _effective_rawdict_flags()
        lyric_use_extract_spans = not _env_falsy("MASK_PDF_LYRIC_USE_EXTRACT_SPANS")

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
                use_spans = lyric_use_extract_spans and _item_has_extract_spans_for_mask(item)
                if use_spans:
                    spans_list = item.get("spans") or []
                    union_r = _rect_union_normalized(
                        [
                            fitz.Rect(s["bbox"]).normalize()
                            for s in spans_list
                            if isinstance(s, dict) and isinstance(s.get("bbox"), (list, tuple))
                        ]
                    )
                    anchor = union_r if not union_r.is_empty else rect
                    scan = _clip_vertical_grow_into_page(anchor, page, staff_scan)
                    lyric_glyphs = _lyric_glyphs_from_extract_spans(spans_list, lyric_pad)
                    _, music_rects = _collect_lyric_glyphs_and_music_rects(
                        page,
                        scan,
                        0.0,
                        music_pad,
                        rawdict_flags,
                        korean_overlay_only=False,
                    )
                    if not lyric_glyphs:
                        scan = _clip_vertical_grow_into_page(rect, page, staff_scan)
                        lyric_glyphs, music_rects = _collect_lyric_glyphs_and_music_rects(
                            page,
                            scan,
                            lyric_pad,
                            music_pad,
                            rawdict_flags,
                        )
                else:
                    scan = _clip_vertical_grow_into_page(rect, page, staff_scan)
                    lyric_glyphs, music_rects = _collect_lyric_glyphs_and_music_rects(
                        page,
                        scan,
                        lyric_pad,
                        music_pad,
                        rawdict_flags,
                    )
                if music_safe_overlap and music_rects:
                    lyric_glyphs = _lyric_glyphs_skip_music_overlap(
                        lyric_glyphs,
                        music_rects,
                        legacy_intersect=music_overlap_legacy_intersect,
                        min_overlap_ratio=music_overlap_min,
                        bypass_music_overlap_for_korean_overlay=korean_music_overlap_bypass,
                    )
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

        # 사용자가 검토 UI에서 직사각형으로 지정한 영역: bbox 안 글림만 선택 리덕, MUSIC_SAFE 생략 없음.
        if lyric_selective and not _env_falsy("MASK_PDF_MANUAL_LYRIC_MASK"):
            specs: list[tuple[int, fitz.Rect]] = []
            for item in data:
                if item.get("type") != "_manual_lyric_mask":
                    continue
                mr = item.get("manualRects")
                if not isinstance(mr, list):
                    continue
                for zone in mr:
                    if not isinstance(zone, dict):
                        continue
                    try:
                        p1 = int(zone.get("page", 0) or 0)
                    except (TypeError, ValueError):
                        continue
                    if p1 < 1:
                        continue
                    bb = zone.get("bbox")
                    if not bb or not isinstance(bb, (list, tuple)) or len(bb) < 4:
                        continue
                    try:
                        r = fitz.Rect(
                            float(bb[0]),
                            float(bb[1]),
                            float(bb[2]),
                            float(bb[3]),
                        ).normalize()
                    except (TypeError, ValueError):
                        continue
                    if r.is_empty:
                        continue
                    specs.append((p1 - 1, r))
            for page_idx, rr in specs:
                if page_idx < 0 or page_idx >= len(doc):
                    continue
                page = doc[page_idx]
                pr = fitz.Rect(page.rect).normalize()
                clip = (rr.normalize() & pr).normalize()
                if clip.is_empty:
                    continue
                manual_gly, _muz_ignore = _collect_lyric_glyphs_and_music_rects(
                    page,
                    clip,
                    lyric_pad,
                    music_pad,
                    rawdict_flags,
                )
                if not manual_gly:
                    continue
                bucket = lyric_glyphs_by_page.setdefault(page_idx, [])
                seen_keys = {_lyric_glyph_dedupe_key(x) for x in bucket}
                for g in manual_gly:
                    k = _lyric_glyph_dedupe_key(g)
                    if k in seen_keys:
                        continue
                    seen_keys.add(k)
                    bucket.append(g)

        # 검토 타입별로 원문은 이미 JSON에 있으므로, Audiveris용 마스킹 PDF에서는
        # 페이지에 남은 한글(검토 박스 누락 포함)을 추가로 지웁니다. 기본 켜짐,
        # `MASK_PDF_GLOBAL_HANGUL_SYLLABLE_BLANK=0` 으로 끕니다.
        global_hangul = lyric_selective and not _env_falsy("MASK_PDF_GLOBAL_HANGUL_SYLLABLE_BLANK")
        if global_hangul:
            for page_idx in range(len(doc)):
                page = doc[page_idx]
                scan = fitz.Rect(page.rect).normalize()
                if scan.is_empty:
                    continue
                extra_gly, muz = _collect_lyric_glyphs_and_music_rects(
                    page,
                    scan,
                    lyric_pad,
                    music_pad,
                    rawdict_flags,
                    korean_overlay_only=True,
                )
                if music_safe_overlap and muz:
                    extra_gly = _lyric_glyphs_skip_music_overlap(
                        extra_gly,
                        muz,
                        legacy_intersect=music_overlap_legacy_intersect,
                        min_overlap_ratio=music_overlap_min,
                        bypass_music_overlap_for_korean_overlay=korean_music_overlap_bypass,
                    )
                if not extra_gly:
                    continue
                bucket = lyric_glyphs_by_page.setdefault(page_idx, [])
                seen_keys = {_lyric_glyph_dedupe_key(x) for x in bucket}
                for g in extra_gly:
                    k = _lyric_glyph_dedupe_key(g)
                    if k in seen_keys:
                        continue
                    seen_keys.add(k)
                    bucket.append(g)

        try:
            lyric_redact_passes = int(os.environ.get("MASK_PDF_LYRIC_REDACT_PASSES", "2") or 2)
        except ValueError:
            lyric_redact_passes = 2
        lyric_redact_passes = max(1, min(8, lyric_redact_passes))

        try:
            min_redact_h = float(os.environ.get("MASK_PDF_LYRIC_REDACT_MIN_HEIGHT_PT", "0.35") or 0.35)
        except ValueError:
            min_redact_h = 0.35
        min_redact_h = max(0.0, min(min_redact_h, 24.0))

        kr_raw = os.environ.get("MASK_PDF_LYRIC_REDACT_KOREAN_BOTTOM_KEEP_FRAC", "").strip()
        if not kr_raw:
            korean_bottom_keep_frac = 1.0
        else:
            try:
                korean_bottom_keep_frac = float(kr_raw)
            except ValueError:
                korean_bottom_keep_frac = 1.0
        if korean_bottom_keep_frac <= 0:
            korean_bottom_keep_frac = 1.0
        elif korean_bottom_keep_frac > 1.0:
            korean_bottom_keep_frac = 1.0
        mx_raw = os.environ.get("MASK_PDF_LYRIC_REDACT_MAX_HEIGHT_EM", "").strip()
        try:
            max_redact_height_em = float(mx_raw or "1.14")
        except ValueError:
            max_redact_height_em = 1.14
        if max_redact_height_em < 0:
            max_redact_height_em = 0.0
        pages_with_redact = sorted(set(redact_rects.keys()) | set(lyric_glyphs_by_page.keys()))
        pages_with_lyric_glyphs = sorted(lyric_glyphs_by_page.keys())

        def _apply_lyric_redactions_on_page(
            page: fitz.Page,
            pidx: int,
            glyph_rows: list[LyricGlyph],
            *,
            first_pass: bool,
        ) -> None:
            for _ov, r2, fsize, span_font, color_i, _gh in glyph_rows:
                r_adj = _finalize_lyric_redact_glyph_rect(
                    _ov,
                    r2,
                    fsize,
                    _gh,
                    min_redact_h,
                    max_height_em=max_redact_height_em,
                    korean_bottom_keep_frac=korean_bottom_keep_frac,
                )
                _add_lyric_glyph_redaction(
                    page,
                    r_adj,
                    fontsize=fsize,
                    span_font=span_font,
                    rgb=_pdf_color_int_to_rgb(color_i),
                    plain_old_white_fill=lyric_plain_redact_white,
                    replacement_glyph=lyric_blank_glyph,
                )
            if first_pass:
                for r in redact_rects.get(pidx, []):
                    page.add_redact_annot(r)

            rects_fallback = redact_rects.get(pidx, []) or [] if first_pass else []

            if not _apply_page_redactions(page):
                print(
                    "[mask_pdf] warn: apply_redactions unsupported; "
                    "falling back to white rectangles (may hide noteheads). "
                    "Upgrade PyMuPDF if possible.",
                    file=sys.stderr,
                )
                for annot in list(page.annots() or []):
                    if annot.type[1] == "Redact":
                        page.delete_annot(annot)
                if first_pass:
                    for _ov, r2, _fs, _sf, _ci, _gh in glyph_rows:
                        page.draw_rect(
                            _finalize_lyric_redact_glyph_rect(
                                _ov,
                                r2,
                                _fs,
                                _gh,
                                min_redact_h,
                                max_height_em=max_redact_height_em,
                                korean_bottom_keep_frac=korean_bottom_keep_frac,
                            ),
                            color=(1, 1, 1),
                            fill=(1, 1, 1),
                        )
                    for r in rects_fallback:
                        page.draw_rect(r, color=(1, 1, 1), fill=(1, 1, 1))

        for page_idx in pages_with_redact:
            page = doc[page_idx]
            rows0 = lyric_glyphs_by_page.get(page_idx, [])
            _apply_lyric_redactions_on_page(page, page_idx, rows0, first_pass=True)

        # 동일 어절이 PDF에 텍스트로 이중 삽입된 경우 1차 apply 후에만 두 번째 겹침이 드러나는 경우가 있어,
        # 남은 글림을 다시 읽어 리덕합니다. (한글 전역 패스와 동일한 korean_overlay_only 규칙)
        # 전역 한글 패스가 꺼지면 페이지 전역 재수집으로 제목·푸터 라틴까지 건드릴 수 있어,
        # 두 번째 이후 패스는 기본적으로 global_hangul 일 때만 수행합니다.
        if lyric_selective and lyric_redact_passes > 1 and pages_with_lyric_glyphs and global_hangul:
            for _rip in range(1, lyric_redact_passes):
                for page_idx in pages_with_lyric_glyphs:
                    page = doc[page_idx]
                    scan = fitz.Rect(page.rect).normalize()
                    if scan.is_empty:
                        continue
                    again, muz = _collect_lyric_glyphs_and_music_rects(
                        page,
                        scan,
                        lyric_pad,
                        music_pad,
                        rawdict_flags,
                        korean_overlay_only=True,
                    )
                    if music_safe_overlap and muz:
                        again = _lyric_glyphs_skip_music_overlap(
                            again,
                            muz,
                            legacy_intersect=music_overlap_legacy_intersect,
                            min_overlap_ratio=music_overlap_min,
                            bypass_music_overlap_for_korean_overlay=korean_music_overlap_bypass,
                        )
                    if not again:
                        continue
                    _apply_lyric_redactions_on_page(page, page_idx, again, first_pass=False)

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
