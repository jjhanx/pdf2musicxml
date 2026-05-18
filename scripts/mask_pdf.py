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
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    doc = fitz.open(pdf_in)
    use_text_redact = _env_truthy("MASK_PDF_TEXT_REDACT")

    # Types to mask so Audiveris doesn't get confused (템포 문자는 검토 후 MusicXML에 주입)
    mask_types = {'title', 'composer', 'lyricist', 'copyright', 'lyrics', 'tempo'}

    # 페이지별로 모은 뒤 한 번에 apply_redactions (텍스트·그래픽 처리 일관성)
    redact_rects: dict[int, list[fitz.Rect]] = {}
    white_rects: dict[int, list[fitz.Rect]] = {}

    for item in data:
        item_type = item.get('type', 'unknown')
        if item_type not in mask_types:
            continue
        page_idx = item.get('page', 1) - 1
        bbox = item.get('bbox')
        if not bbox or not (0 <= page_idx < len(doc)):
            continue
        page = doc[page_idx]
        rect = fitz.Rect(bbox).normalize()
        if rect.is_empty:
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
            # kwargs 미지원(구버전): 리독 주석만 제거하고 기존 흰 박스로 폴백
            for annot in list(page.annots() or []):
                if annot.type[1] == 'Redact':
                    page.delete_annot(annot)
            for r in rects:
                page.draw_rect(r, color=(1, 1, 1), fill=(1, 1, 1))

    for page_idx, rects in white_rects.items():
        page = doc[page_idx]
        for r in rects:
            page.draw_rect(r, color=(1, 1, 1), fill=(1, 1, 1))

    doc.save(pdf_out)
    doc.close()

if __name__ == '__main__':
    if len(sys.argv) < 4:
        print("Usage: python mask_pdf.py <pdf_in> <pdf_out> <json_path>")
        sys.exit(1)
    mask_pdf(sys.argv[1], sys.argv[2], sys.argv[3])
