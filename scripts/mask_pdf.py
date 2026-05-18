import os
import sys
import json
import fitz

# PyMuPDF 리독: 이론상 텍스트만 제거·벡터 보존.
# 실제 악보 PDF는 SMuFL 등으로 음표·잇단이 "텍스트 글리프"인 경우가 많아,
# 가사 bbox와 겹치면 음표까지 글리프로 지워져 오히려 손해가 날 수 있음 → 기본은 흰 박스.
_PDF_REDACT_IMAGE_NONE = getattr(fitz, "PDF_REDACT_IMAGE_NONE", 0)
_PDF_REDACT_LINE_ART_NONE = getattr(fitz, "PDF_REDACT_LINE_ART_NONE", 0)
_PDF_REDACT_TEXT_REMOVE = getattr(fitz, "PDF_REDACT_TEXT_REMOVE", 0)


def _env_truthy(name: str) -> bool:
    v = os.environ.get(name, "").strip().lower()
    return v in ("1", "true", "yes", "on")


def _env_falsy(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("0", "false", "no", "off")


def _char_is_music_glyph(cp: int) -> bool:
    """PDF 텍스트에 자주 쓰이는 악보 기호(유니코드) — 리독/마스크에서 보호할 영역 판별용."""
    # SMuFL 기본 평면 PUA
    if 0xE000 <= cp <= 0xF8FF:
        return True
    # Musical Symbols
    if 0x1D100 <= cp <= 0x1D1FF:
        return True
    # 일반 뮤직 심볼(♩ ♪ 등)
    if cp in (0x2669, 0x266A, 0x266B, 0x266C):
        return True
    # 보조 PUA(일부 임베딩)
    if 0xF0000 <= cp <= 0xFFFFD or 0x100000 <= cp <= 0x10FFFD:
        return True
    return False


def _page_music_protect_rects(page: fitz.Page, pad: float) -> list[fitz.Rect]:
    """악보 기호가 텍스트로 박힌 span의 bbox 목록(여유 pad pt)."""
    out: list[fitz.Rect] = []
    try:
        blocks = page.get_text("dict")["blocks"]
    except Exception:
        return out
    for b in blocks or []:
        if b.get("type") != 0:
            continue
        for line in b.get("lines") or []:
            for sp in line.get("spans") or []:
                txt = sp.get("text") or ""
                if not any(_char_is_music_glyph(ord(ch)) for ch in txt):
                    continue
                bb = sp.get("bbox")
                if not bb:
                    continue
                r = fitz.Rect(bb).normalize()
                if r.is_empty:
                    continue
                out.append(
                    fitz.Rect(r.x0 - pad, r.y0 - pad, r.x1 + pad, r.y1 + pad).normalize()
                )
    return out


def _rect_minus(r: fitz.Rect, p: fitz.Rect) -> list[fitz.Rect]:
    """축 정렬 사각형 r에서 p(교집합 부분)를 뺀 조각들."""
    r = r.normalize()
    p = p.normalize()
    if not r.intersects(p):
        return [r]
    ix0 = max(r.x0, p.x0)
    iy0 = max(r.y0, p.y0)
    ix1 = min(r.x1, p.x1)
    iy1 = min(r.y1, p.y1)
    if ix0 >= ix1 or iy0 >= iy1:
        return [r]
    out: list[fitz.Rect] = []
    if r.y0 < iy0 - 0.01:
        out.append(fitz.Rect(r.x0, r.y0, r.x1, iy0))
    if iy1 < r.y1 - 0.01:
        out.append(fitz.Rect(r.x0, iy1, r.x1, r.y1))
    if r.x0 < ix0 - 0.01:
        out.append(fitz.Rect(r.x0, iy0, ix0, iy1))
    if ix1 < r.x1 - 0.01:
        out.append(fitz.Rect(ix1, iy0, r.x1, iy1))
    return [o for o in out if not o.is_empty]


def _mask_rect_fragments(mask_r: fitz.Rect, protected: list[fitz.Rect], min_w: float, min_h: float) -> list[fitz.Rect]:
    pieces: list[fitz.Rect] = [mask_r.normalize()]
    for p in protected:
        if not pieces:
            break
        nxt: list[fitz.Rect] = []
        for q in pieces:
            nxt.extend(_rect_minus(q, p))
        pieces = nxt
    return [q for q in pieces if q.width >= min_w and q.height >= min_h]


def _rect_has_vector_text(page: fitz.Page, rect: fitz.Rect) -> bool:
    """이 bbox 안에 PDF 텍스트 연산자(실글리프)가 있으면 True. 순수 비트맵+OCR만 있는 구역은 False."""
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

    doc = fitz.open(pdf_in)
    use_text_redact = _env_truthy("MASK_PDF_TEXT_REDACT")
    protect_music = not _env_falsy("MASK_PDF_PROTECT_MUSIC")
    try:
        guard = float(os.environ.get("MASK_PDF_MUSIC_GUARD_PT", "1.5") or 1.5)
    except ValueError:
        guard = 1.5
    try:
        min_frag_w = float(os.environ.get("MASK_PDF_MIN_FRAG_W", "2") or 2)
        min_frag_h = float(os.environ.get("MASK_PDF_MIN_FRAG_H", "2.5") or 2.5)
    except ValueError:
        min_frag_w, min_frag_h = 2.0, 2.5

    mask_types = {"title", "composer", "lyricist", "copyright", "lyrics", "tempo"}

    redact_rects: dict[int, list[fitz.Rect]] = {}
    white_rects: dict[int, list[fitz.Rect]] = {}

    protect_cache: dict[int, list[fitz.Rect]] = {}

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

        if protect_music:
            if page_idx not in protect_cache:
                protect_cache[page_idx] = _page_music_protect_rects(page, guard)
            fragments = _mask_rect_fragments(rect, protect_cache[page_idx], min_frag_w, min_frag_h)
        else:
            fragments = [rect]

        for frag in fragments:
            if use_text_redact and _rect_has_vector_text(page, frag):
                redact_rects.setdefault(page_idx, []).append(frag)
            else:
                white_rects.setdefault(page_idx, []).append(frag)

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
    doc.close()


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python mask_pdf.py <pdf_in> <pdf_out> <json_path>")
        sys.exit(1)
    mask_pdf(sys.argv[1], sys.argv[2], sys.argv[3])
