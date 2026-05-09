import sys
import json
import os

PROGRESS_PREFIX = "PDF2MXL_PROGRESS "

def emit_progress(phase, current, total, detail=None):
    """Node 서버가 stderr 한 줄로 파싱해 UI 진행률에 반영합니다."""
    payload = {"phase": phase, "current": int(current), "total": int(total)}
    if detail:
        payload["detail"] = detail
    print(PROGRESS_PREFIX + json.dumps(payload, ensure_ascii=False), file=sys.stderr, flush=True)

try:
    import fitz  # PyMuPDF
except ImportError:
    print("Error: PyMuPDF is not installed. Please run: pip install PyMuPDF", file=sys.stderr)
    sys.exit(1)

try:
    import easyocr
    import numpy as np
except ImportError:
    print("Error: easyocr or numpy is not installed. Please run: pip install easyocr numpy", file=sys.stderr)
    sys.exit(1)

# 한 페이지에서 이 이상은 '텍스트가 있는 벡터 PDF'로 보고 해당 페이지 OCR 생략
MIN_VECTOR_CHARS_TO_SKIP_OCR = int(os.environ.get("PDF2MXL_VECTOR_OCR_SKIP_THRESHOLD", "40"))


def extract_vector_spans(page):
    """
    임베디드 글리프(벡터 PDF)에서 텍스트와 bbox 추출. OCR보다 정확한 한글에 유리.
    bbox: PDF 좌표계 x0,y0,x1,y1
    """
    out = []
    try:
        td = page.get_text("dict")
    except Exception:
        return out
    for block in td.get("blocks", []):
        if block.get("type") != 0:  # 0=text
            continue
        for line in block.get("lines", []):
            for sp in line.get("spans", []):
                t = (sp.get("text") or "").strip()
                if not t:
                    continue
                bb = sp.get("bbox")
                if not bb or len(bb) < 4:
                    continue
                x0, y0, x1, y1 = float(bb[0]), float(bb[1]), float(bb[2]), float(bb[3])
                if x1 <= x0 or y1 <= y0:
                    continue
                out.append({"text": t, "bbox": [x0, y0, x1, y1], "source": "vector"})
    return out


def mask_blocks(page, blocks, zoom=1.0, pad=1.5):
    """blocks: list with bbox in PDF 좌표"""
    for b in blocks:
        x0, y0, x1, y1 = b["bbox"]
        rect = fitz.Rect(x0 - pad, y0 - pad, x1 + pad, y1 + pad)
        page.draw_rect(rect, color=(1, 1, 1), fill=(1, 1, 1), overlay=True)


def rect_iou(a, b):
    """a,b: fitz.Rect"""
    inter = a & b
    if inter.is_empty:
        return 0.0
    ia = inter.get_area()
    aa = a.get_area()
    ba = b.get_area()
    union = aa + ba - ia
    return ia / union if union > 0 else 0.0


def extract_and_mask_text(input_pdf_path, output_pdf_path, output_json_path):
    try:
        doc = fitz.open(input_pdf_path)
    except Exception as e:
        print(f"Error opening PDF: {e}", file=sys.stderr)
        sys.exit(1)

    page_count = len(doc)

    # 페이지별 OCR 필요 여부
    skip_ocr_flags = []
    for page_num in range(page_count):
        page = doc[page_num]
        vb = extract_vector_spans(page)
        vc = sum(len(b["text"]) for b in vb)
        skip_ocr_flags.append(vc >= MIN_VECTOR_CHARS_TO_SKIP_OCR)

    if not any(skip_ocr_flags):
        emit_progress("ocr", 0, page_count, "EasyOCR 초기화 중")
        print("Initializing EasyOCR reader (this may take a moment)...", flush=True)
        reader = easyocr.Reader(['ko', 'en'])
    elif all(skip_ocr_flags):
        print("Skipping EasyOCR: vector text sufficient on all pages.", flush=True)
        reader = None
    else:
        emit_progress("ocr", 0, page_count, "EasyOCR 초기화 중 (일부 페이지만)")
        print("Initializing EasyOCR reader (partial pages only)...", flush=True)
        reader = easyocr.Reader(['ko', 'en'])

    all_text_data = []

    for page_num in range(page_count):
        page = doc[page_num]
        emit_progress(
            "ocr",
            page_num + 1,
            page_count,
            f"페이지 {page_num + 1}/{page_count} 벡터 추출·마스킹"
            + ("" if skip_ocr_flags[page_num] else " + OCR"),
        )
        print(f"Processing page {page_num + 1}/{page_count}...", flush=True)

        vector_blocks = extract_vector_spans(page)
        page_blocks = [dict(b) for b in vector_blocks]
        mask_blocks(page, vector_blocks)

        if reader is None or skip_ocr_flags[page_num]:
            all_text_data.append({"page": page_num + 1, "blocks": page_blocks})
            continue

        # 남은 영역(가사 찌꺼기 등) OCR
        zoom = 1.5
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False, colorspace=fitz.csRGB)
        img_np = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, 3)
        results = reader.readtext(img_np)

        vector_rects = [fitz.Rect(b["bbox"]) for b in vector_blocks]

        for (bbox, text, prob) in results:
            text = text.strip()
            if not text or prob < 0.3:
                continue
            x0 = min(p[0] for p in bbox) / zoom
            y0 = min(p[1] for p in bbox) / zoom
            x1 = max(p[0] for p in bbox) / zoom
            y1 = max(p[1] for p in bbox) / zoom
            pad = 2
            ocr_rect = fitz.Rect(max(0, x0 - pad), max(0, y0 - pad), x1 + pad, y1 + pad)
            if any(rect_iou(ocr_rect, vr) > 0.25 for vr in vector_rects):
                continue
            page_blocks.append({
                "text": text,
                "bbox": [ocr_rect.x0, ocr_rect.y0, ocr_rect.x1, ocr_rect.y1],
                "source": "ocr",
            })
            page.draw_rect(ocr_rect, color=(1, 1, 1), fill=(1, 1, 1), overlay=True)

        all_text_data.append({"page": page_num + 1, "blocks": page_blocks})

    doc.save(output_pdf_path)
    doc.close()

    with open(output_json_path, 'w', encoding='utf-8') as f:
        json.dump(all_text_data, f, ensure_ascii=False, indent=2)

    print(f"Success. Extracted text to {output_json_path} and masked PDF to {output_pdf_path}", flush=True)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python pdf_text_extractor.py <input.pdf> <masked_output.pdf> <text_data.json>", file=sys.stderr)
        sys.exit(1)

    input_pdf = sys.argv[1]
    output_pdf = sys.argv[2]
    output_json = sys.argv[3]

    extract_and_mask_text(input_pdf, output_pdf, output_json)
