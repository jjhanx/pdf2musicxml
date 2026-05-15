import sys
import os
import json
import re

def extract_vector(pdf_path, output_json_path, crops_dir, doc):
    import fitz
    from PIL import Image
    results = []
    
    for page_idx, page in enumerate(doc):
        zoom = 300 / 72
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat)
        
        # PIL Image for cropping
        if pix.alpha:
            img = Image.frombytes("RGBA", [pix.width, pix.height], pix.samples).convert("RGB")
        else:
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        
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
                        
                        pad = 3
                        x_min = max(0, int(x0) - pad)
                        y_min = max(0, int(y0) - pad)
                        x_max = min(img.width, int(x1) + pad)
                        y_max = min(img.height, int(y1) + pad)
                        
                        if x_max <= x_min or y_max <= y_min:
                            continue
                            
                        crop = img.crop((x_min, y_min, x_max, y_max))
                        crop_filename = f"crop_p{page_idx+1}_{item_idx}.png"
                        crop_path = os.path.join(crops_dir, crop_filename)
                        crop.save(crop_path)
                        
                        x_center = (x_min + x_max) / 2
                        y_center = (y_min + y_max) / 2
                        
                        results.append({
                            "id": f"p{page_idx+1}_{item_idx}",
                            "page": page_idx + 1,
                            "text": text,
                            "confidence": 1.0,
                            "x": float(x_center),
                            "y": float(y_center),
                            "bbox": bbox, # Original points for masking
                            "crop_filename": crop_filename,
                            "type": "unknown",
                            "note_count": len(re.sub(r'\s+', '', text)) # Default note count to char count without spaces
                        })
                        item_idx += 1
                        
    with open(output_json_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

def extract_image(pdf_path, output_json_path, crops_dir):
    os.environ['FLAGS_enable_pir_api'] = '0'
    os.environ['PADDLE_DISABLE_PIR'] = '1'
    from paddleocr import PaddleOCR
    from pdf2image import convert_from_path
    import numpy as np
    from PIL import Image
    
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
                
                pad = 3
                x_min = max(0, x_min - pad)
                y_min = max(0, y_min - pad)
                x_max = min(img.width, x_max + pad)
                y_max = min(img.height, y_max + pad)
                
                crop = img.crop((x_min, y_min, x_max, y_max))
                crop_filename = f"crop_p{page_idx+1}_{item_idx}.png"
                crop_path = os.path.join(crops_dir, crop_filename)
                crop.save(crop_path)
                
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
                    "crop_filename": crop_filename,
                    "type": "unknown",
                    "note_count": len(re.sub(r'\s+', '', text))
                })
                    
    with open(output_json_path, 'w', encoding='utf-8') as f:
        json.dump(ocr_results, f, ensure_ascii=False, indent=2)

def main():
    if len(sys.argv) < 4:
        print("Usage: python extract_text.py <pdf_path> <output_json_path> <crops_dir>")
        sys.exit(1)
        
    pdf_path = sys.argv[1]
    output_json_path = sys.argv[2]
    crops_dir = sys.argv[3]
    
    os.makedirs(crops_dir, exist_ok=True)
    
    import fitz
    doc = fitz.open(pdf_path)
    
    # Check if vector
    text_length = sum(len(page.get_text("text").strip()) for page in doc)
    
    if text_length > 30:
        print(f"Detected vector PDF ({text_length} chars). Using PyMuPDF.")
        extract_vector(pdf_path, output_json_path, crops_dir, doc)
    else:
        print("Detected image PDF. Falling back to PaddleOCR.")
        extract_image(pdf_path, output_json_path, crops_dir)

if __name__ == '__main__':
    main()
