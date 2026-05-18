import sys
import json
import fitz

# PyMuPDF 리독: 텍스트만 제거하고 이미지·벡터(오선 등)는 건드리지 않음
# (숫자 0은 문서상 IMAGE_NONE / LINE_ART_NONE / TEXT_REMOVE 와 동일)
_PDF_REDACT_IMAGE_NONE = getattr(fitz, "PDF_REDACT_IMAGE_NONE", 0)
_PDF_REDACT_LINE_ART_NONE = getattr(fitz, "PDF_REDACT_LINE_ART_NONE", 0)
_PDF_REDACT_TEXT_REMOVE = getattr(fitz, "PDF_REDACT_TEXT_REMOVE", 0)


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

        if _rect_has_vector_text(page, rect):
            redact_rects.setdefault(page_idx, []).append(rect)
        else:
            # 이미지 PDF 등: PDF에 글리프가 없으면 리독으로는 가사가 안 지워지므로 기존 방식
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
