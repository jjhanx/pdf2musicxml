import sys
import os
import json
import re

# Disable Paddle IR to prevent NotImplementedError with newer Paddle versions
os.environ['FLAGS_enable_pir_api'] = '0'
os.environ['PADDLE_DISABLE_PIR'] = '1'

from pdf2image import convert_from_path
from paddleocr import PaddleOCR

def extract_ocr(pdf_path, output_json_path, crops_dir):
    os.makedirs(crops_dir, exist_ok=True)
    
    ocr = PaddleOCR(use_angle_cls=False, lang='korean', det_limit_side_len=960)
    images = convert_from_path(pdf_path, dpi=150)
    
    ocr_results = []
    
    for page_idx, img in enumerate(images):
        import numpy as np
        img_cv = np.array(img)
        result = ocr.ocr(img_cv)
        if result and result[0]:
            for item_idx, line in enumerate(result[0]):
                bbox = line[0]
                text = line[1][0]
                confidence = line[1][1]
                
                if re.search(r'[가-힣]', text):
                    y_center = sum(p[1] for p in bbox) / 4
                    x_center = sum(p[0] for p in bbox) / 4
                    
                    # Create a crop of the bounding box
                    xs = [p[0] for p in bbox]
                    ys = [p[1] for p in bbox]
                    x_min, x_max = int(min(xs)), int(max(xs))
                    y_min, y_max = int(min(ys)), int(max(ys))
                    
                    pad = 5
                    x_min = max(0, x_min - pad)
                    y_min = max(0, y_min - pad)
                    x_max = min(img.width, x_max + pad)
                    y_max = min(img.height, y_max + pad)
                    
                    crop = img.crop((x_min, y_min, x_max, y_max))
                    crop_filename = f"crop_p{page_idx+1}_{item_idx}.png"
                    crop_path = os.path.join(crops_dir, crop_filename)
                    crop.save(crop_path)
                    
                    item_id = f"p{page_idx+1}_{item_idx}"
                    
                    ocr_results.append({
                        "id": item_id,
                        "page": page_idx + 1,
                        "text": text,
                        "confidence": float(confidence),
                        "x": float(x_center),
                        "y": float(y_center),
                        "crop_filename": crop_filename
                    })
                    
    with open(output_json_path, 'w', encoding='utf-8') as f:
        json.dump(ocr_results, f, ensure_ascii=False, indent=2)

if __name__ == '__main__':
    if len(sys.argv) < 4:
        print("Usage: python extract_ocr.py <pdf_path> <output_json_path> <crops_dir>")
        sys.exit(1)
    extract_ocr(sys.argv[1], sys.argv[2], sys.argv[3])
