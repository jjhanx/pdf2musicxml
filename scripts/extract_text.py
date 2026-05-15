import sys
import os
import json
import re

def extract_vector(pdf_path, output_json_path, doc):
    import fitz
    results = []
    
    for page_idx, page in enumerate(doc):
        zoom = 300 / 72
        
        blocks = page.get_text("dict")["blocks"]
        item_idx = 0
        for b in blocks:
            if b['type'] == 0:  # Text block
                for l in b["lines"]:
                    for s in l["spans"]:
                        text = s["text"].strip()
                        if not text: continue
                        
                        bbox = s["bbox"]  # (x0, y0, x1, y1) in points
                        x0, y0, x1, y1 = [coord * zoom for coord in bbox]
                        
                        x_center = (x0 + x1) / 2
                        y_center = (y0 + y1) / 2
                        
                        results.append({
                            "id": f"p{page_idx+1}_{item_idx}",
                            "page": page_idx + 1,
                            "text": text,
                            "confidence": 1.0,
                            "x": float(x_center),
                            "y": float(y_center),
                            "bbox": bbox, # Original points for masking
                            "type": "unknown",
                        })
                        item_idx += 1
                        
    with open(output_json_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

def extract_image(pdf_path, output_json_path):
    os.environ['FLAGS_enable_pir_api'] = '0'
    os.environ['PADDLE_DISABLE_PIR'] = '1'
    from paddleocr import PaddleOCR
    from pdf2image import convert_from_path
    import numpy as np
    
    ocr = PaddleOCR(use_angle_cls=False, lang='korean', det_limit_side_len=2560)
    images = convert_from_path(pdf_path, dpi=300)
    
    ocr_results = []
    
    for page_idx, img in enumerate(images):
        img_cv = np.array(img)
        result = ocr.ocr(img_cv)
        if result and result[0]:
            for item_idx, line in enumerate(result[0]):
                bbox = line[0]
                text = line[1][0]
                confidence = line[1][1]
                
                # Exclude if it's completely empty or whitespace
                if not text.strip(): continue
                
                xs = [p[0] for p in bbox]
                ys = [p[1] for p in bbox]
                x_min, x_max = int(min(xs)), int(max(xs))
                y_min, y_max = int(min(ys)), int(max(ys))
                
                x_center = sum(p[0] for p in bbox) / 4
                y_center = sum(p[1] for p in bbox) / 4
                
                # Original extraction was at 300 DPI, convert back to points for masking
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
        print("Detected image PDF. Falling back to PaddleOCR.")
        extract_image(pdf_path, output_json_path)

if __name__ == '__main__':
    main()
