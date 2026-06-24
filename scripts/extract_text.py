import sys
import json
import re

def strip_pua(text):
    import re
    # Remove Private Use Area characters commonly used for musical symbols
    return re.sub(r'[\uE000-\uF8FF\U000F0000-\U000FFFFF\U00100000-\U0010FFFF]', '', text)

def extract_vector(pdf_path, output_json_path, doc):
    import fitz
    results = []
    
    for page_idx, page in enumerate(doc):
        zoom = 300 / 72
        blocks = page.get_text("dict")["blocks"]
        
        raw_spans = []
        for b in blocks:
            if b['type'] == 0:  # Text block
                for l in b["lines"]:
                    for s in l["spans"]:
                        text = strip_pua(s["text"]).strip()
                        if not text: continue
                        
                        bbox = s["bbox"]  # (x0, y0, x1, y1) in points
                        y_center = (bbox[1] + bbox[3]) / 2
                        raw_spans.append({
                            "text": text,
                            "bbox": bbox,
                            "y_center": y_center,
                            "x0": bbox[0]
                        })
                        
        # Sort by y_center
        raw_spans.sort(key=lambda x: x["y_center"])
        
        lines = []
        current_line = []
        for s in raw_spans:
            if not current_line:
                current_line.append(s)
            else:
                avg_y = sum(x["y_center"] for x in current_line) / len(current_line)
                if abs(s["y_center"] - avg_y) < 5:  # 5 points vertical tolerance
                    current_line.append(s)
                else:
                    lines.append(current_line)
                    current_line = [s]
        if current_line:
            lines.append(current_line)
            
        item_idx = 0
        for line in lines:
            line.sort(key=lambda x: x["x0"])
            
            merged_text = ""
            min_x0 = min(s["bbox"][0] for s in line)
            min_y0 = min(s["bbox"][1] for s in line)
            max_x1 = max(s["bbox"][2] for s in line)
            max_y1 = max(s["bbox"][3] for s in line)
            
            for i, s in enumerate(line):
                if i > 0:
                    prev = line[i-1]
                    gap = s["bbox"][0] - prev["bbox"][2]
                    # If gap is large enough (e.g. > 4 points), add a space
                    if gap > 4:
                        merged_text += " "
                merged_text += s["text"]
                
            merged_text = merged_text.strip()
            if not merged_text:
                continue
                
            x_center = (min_x0 + max_x1) / 2
            y_center = (min_y0 + max_y1) / 2
            
            # Use original points (72 DPI) for bbox so mask_pdf.py can draw rect accurately
            original_bbox = [float(min_x0), float(min_y0), float(max_x1), float(max_y1)]
            
            # 줄 단위 병합 bbox와 별도로, 각 PyMuPDF span의 bbox를 보존하면
            # mask_pdf가 «추출에 쓰였던 좌표»에만 리덕하여 인접 스태프까지 덜 비칩니다.
            span_payload = [
                {
                    "text": s["text"],
                    "bbox": [float(x) for x in s["bbox"]],
                }
                for s in line
                if s.get("text") and s.get("bbox") and len(s["bbox"]) >= 4
            ]
            results.append({
                "id": f"p{page_idx+1}_{item_idx}",
                "page": page_idx + 1,
                "text": merged_text,
                "confidence": 1.0,
                "x": float(x_center * zoom), # UI might still sort or use these in 300 DPI equivalent
                "y": float(y_center * zoom),
                "bbox": original_bbox,
                "spans": span_payload,
                "type": "unknown",
            })
            item_idx += 1
                        
    with open(output_json_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

def extract_image(pdf_path, output_json_path):
    from pdf2image import convert_from_path
    import numpy as np
    from rapidocr import EngineType, LangRec, ModelType, RapidOCR
    from rapidocr.utils.typings import OCRVersion

    # PaddleOCR는 numpy<2 전용이라 homr(numpy>=2.2.6)과 공존할 수 없음 → RapidOCR(한국어 PP-OCRv5).
    engine = RapidOCR(
        params={
            "Rec.lang_type": LangRec.KOREAN,
            "Rec.engine_type": EngineType.ONNXRUNTIME,
            "Rec.ocr_version": OCRVersion.PPOCRV5,
            "Rec.model_type": ModelType.MOBILE,
            "Global.use_cls": False,
            "Det.limit_side_len": 2560,
        }
    )
    images = convert_from_path(pdf_path, dpi=300)

    ocr_results = []

    for page_idx, img in enumerate(images):
        img_cv = np.array(img)
        result = engine(img_cv, use_cls=False)
        if result is None or not result.txts:
            continue
        for item_idx, (bbox, text, confidence) in enumerate(
            zip(result.boxes, result.txts, result.scores)
        ):
            text = strip_pua(text)

            if not text.strip():
                continue

            xs = [p[0] for p in bbox]
            ys = [p[1] for p in bbox]
            x_min, x_max = int(min(xs)), int(max(xs))
            y_min, y_max = int(min(ys)), int(max(ys))

            x_center = sum(p[0] for p in bbox) / 4
            y_center = sum(p[1] for p in bbox) / 4

            zoom = 300 / 72
            bbox_points = [x_min / zoom, y_min / zoom, x_max / zoom, y_max / zoom]

            ocr_results.append({
                "id": f"p{page_idx+1}_{item_idx}",
                "page": page_idx + 1,
                "text": text,
                "confidence": float(confidence),
                "x": float(x_center),
                "y": float(y_center),
                "bbox": bbox_points,
                "type": "unknown",
            })
                    
    with open(output_json_path, 'w', encoding='utf-8') as f:
        json.dump(ocr_results, f, ensure_ascii=False, indent=2)

def main():
    if len(sys.argv) < 3:
        print("Usage: python extract_text.py <pdf_path> <output_json_path>")
        sys.exit(1)
        
    pdf_path = sys.argv[1]
    output_json_path = sys.argv[2]
    
    import fitz
    doc = fitz.open(pdf_path)
    
    # Check if vector
    text_length = sum(len(page.get_text("text").strip()) for page in doc)
    
    if text_length > 30:
        print(f"Detected vector PDF ({text_length} chars). Using PyMuPDF.")
        extract_vector(pdf_path, output_json_path, doc)
    else:
        print("Detected image PDF. Falling back to RapidOCR (Korean).")
        extract_image(pdf_path, output_json_path)

if __name__ == '__main__':
    main()
