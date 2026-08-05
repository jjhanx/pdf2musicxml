import sys
import json
import argparse
import os

try:
    import fitz  # PyMuPDF
except ImportError:
    print("PyMuPDF (fitz) is not installed.", file=sys.stderr)
    sys.exit(1)

def _init_ocr():
    try:
        from rapidocr import EngineType, LangRec, ModelType, RapidOCR
        from rapidocr.utils.typings import OCRVersion
        return RapidOCR(
            params={
                "Rec.lang_type": LangRec.KOREAN,
                "Rec.engine_type": EngineType.ONNXRUNTIME,
                "Rec.ocr_version": OCRVersion.PPOCRV5,
                "Rec.model_type": ModelType.MOBILE,
                "Global.use_cls": False,
                "Det.limit_side_len": 2560,
            }
        )
    except ImportError:
        print("RapidOCR is not installed.", file=sys.stderr)
        sys.exit(1)

def extract(input_pdf: str, output_json: str):
    print(f"[image_pdf_processor] Extracting text from {input_pdf} using PaddleOCR...", file=sys.stderr)
    
    ocr = _init_ocr()
    extracted_data = []
    
    doc = fitz.open(input_pdf)
    zoom = 2.0  # 144 DPI for better OCR
    mat = fitz.Matrix(zoom, zoom)
    
    import numpy as np
    from PIL import Image
    
    for page_idx in range(len(doc)):
        page = doc[page_idx]
        
        page_info = {
            "page_number": page_idx + 1,
            "width": float(page.rect.width),
            "height": float(page.rect.height),
            "text_elements": [],
        }
        
        pix = page.get_pixmap(matrix=mat)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        img_np = np.array(img)
        
        # Run OCR
        res = ocr(img_np)
        
        if res and hasattr(res, 'boxes') and res.boxes is not None:
            for i, box in enumerate(res.boxes):
                text = res.txts[i] if hasattr(res, 'txts') and res.txts else ""
                
                # Convert back to PDF points
                x_coords = [p[0] / zoom for p in box]
                y_coords = [p[1] / zoom for p in box]
                
                x0, x1 = min(x_coords), max(x_coords)
                y0, y1 = min(y_coords), max(y_coords)
                
                # Filter out extremely large boxes that might be staves incorrectly detected
                if (y1 - y0) > (page.rect.height * 0.2):
                    continue
                
                char_info = {
                    "raw_text": text,
                    "x0": round(float(x0), 2),
                    "y0": round(float(y0), 2),
                    "x1": round(float(x1), 2),
                    "y1": round(float(y1), 2),
                    "fontname": "RapidOCR",
                    "size": round(float(y1 - y0), 2),
                }
                page_info["text_elements"].append(char_info)
                
        extracted_data.append(page_info)
        print(f"  - Page {page_idx + 1} extracted.", file=sys.stderr)
        
    doc.close()
    
    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(extracted_data, f, ensure_ascii=False, indent=2)
    print(f" -> {output_json}", file=sys.stderr)

def mask(input_pdf: str, extracted_json: str, output_pdf: str):
    print(f"[image_pdf_processor] Masking PDF {input_pdf} based on {extracted_json}...", file=sys.stderr)
    
    if not os.path.exists(extracted_json):
        print(f"Error: {extracted_json} does not exist.", file=sys.stderr)
        sys.exit(1)
        
    with open(extracted_json, "r", encoding="utf-8") as f:
        extracted_data = json.load(f)
        
    doc = fitz.open(input_pdf)
    
    for page_data in extracted_data:
        page_idx = page_data["page_number"] - 1
        if page_idx < 0 or page_idx >= len(doc):
            continue
            
        page = doc[page_idx]
        
        import re
        def should_skip_mask(text: str) -> bool:
            text = text.strip()
            if not text:
                return True
            if re.match(r'^[\d\s/Cc]+$', text):
                return True
            lower = text.lower()
            dynamics = {"p", "mp", "mf", "f", "ff", "fff", "sfz", "cresc", "cresc.", "dim", "dim.", "rit", "rit.", "a tempo"}
            if lower in dynamics:
                return True
            return False

        for elem in page_data.get("text_elements", []):
            if should_skip_mask(elem.get("raw_text", "")):
                continue
                
            pad = 2.0
            rect = fitz.Rect(elem["x0"] - pad, elem["y0"] - pad, elem["x1"] + pad, elem["y1"] + pad)
            
            # Draw white rectangle
            page.draw_rect(rect, color=(1, 1, 1), fill=(1, 1, 1))
            
    doc.save(output_pdf)
    doc.close()
    print(f" -> {output_pdf}", file=sys.stderr)

def analyze(extracted_json: str):
    # Dummy analyze to satisfy server expectations
    print(json.dumps({"info": "Image PDF mode does not require font size analysis"}))

def main():
    parser = argparse.ArgumentParser(description="Image PDF Processor (OCR & Masking)")
    subparsers = parser.add_subparsers(dest="command", required=True)
    
    # extract
    p_extract = subparsers.add_parser("extract")
    p_extract.add_argument("input_pdf")
    p_extract.add_argument("output_json")
    
    # mask (equivalent to strip)
    p_mask = subparsers.add_parser("mask")
    p_mask.add_argument("input_pdf")
    p_mask.add_argument("extracted_json")
    p_mask.add_argument("output_pdf")
    
    # analyze
    p_analyze = subparsers.add_parser("analyze")
    p_analyze.add_argument("extracted_json")

    args = parser.parse_args()
    
    if args.command == "extract":
        extract(args.input_pdf, args.output_json)
    elif args.command == "mask":
        mask(args.input_pdf, args.extracted_json, args.output_pdf)
    elif args.command == "analyze":
        analyze(args.extracted_json)

if __name__ == "__main__":
    main()
