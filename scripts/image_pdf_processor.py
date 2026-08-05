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
        from rapidocr import RapidOCR
        return RapidOCR()
    except ImportError:
        print("RapidOCR is not installed.", file=sys.stderr)
        sys.exit(1)

def _run_ocr_subprocess(input_pdf: str, output_json: str, use_korean: bool) -> bool:
    import subprocess
    import tempfile
    
    script_code = f"""
import sys
import json
import numpy as np
import fitz
from PIL import Image

def _init_ocr(use_korean):
    try:
        from rapidocr import RapidOCR
        if use_korean:
            # Attempt to use Korean model, may segfault in some environments
            return RapidOCR(params={{"Rec.lang_type": "korean"}})
        return RapidOCR()
    except Exception as e:
        print(f"Failed to initialize RapidOCR: {{e}}", file=sys.stderr)
        sys.exit(1)

def extract():
    ocr = _init_ocr({use_korean})
    extracted_data = []
    doc = fitz.open("{input_pdf}")
    zoom = 2.0
    mat = fitz.Matrix(zoom, zoom)
    
    for page_idx in range(len(doc)):
        page = doc[page_idx]
        page_info = {{"page_number": page_idx + 1, "width": float(page.rect.width), "height": float(page.rect.height), "text_elements": []}}
        pix = page.get_pixmap(matrix=mat)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        img_np = np.array(img)
        
        res = ocr(img_np)
        if res and hasattr(res, 'boxes') and res.boxes is not None:
            for i, box in enumerate(res.boxes):
                text = res.txts[i] if hasattr(res, 'txts') and res.txts else ""
                x_coords = [p[0] / zoom for p in box]
                y_coords = [p[1] / zoom for p in box]
                y0, y1 = min(y_coords), max(y_coords)
                if (y1 - y0) > (page.rect.height * 0.2): continue
                
                char_info = {{"raw_text": text, "x0": round(float(min(x_coords)), 2), "y0": round(float(y0), 2), "x1": round(float(max(x_coords)), 2), "y1": round(float(y1), 2), "fontname": "RapidOCR", "size": round(float(y1 - y0), 2)}}
                page_info["text_elements"].append(char_info)
        extracted_data.append(page_info)
        
    doc.close()
    with open("{output_json}", "w", encoding="utf-8") as f:
        json.dump(extracted_data, f, ensure_ascii=False, indent=2)

if __name__ == '__main__':
    extract()
"""
    with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding='utf-8') as f:
        f.write(script_code)
        script_path = f.name
        
    try:
        print(f"  - Running subprocess (use_korean={use_korean})...", file=sys.stderr)
        # Run the script in a subprocess
        result = subprocess.run([sys.executable, script_path], capture_output=True, text=True)
        if result.returncode != 0:
            print(f"  - Subprocess failed (exit code {result.returncode})", file=sys.stderr)
            if result.stderr:
                print(f"  - Stderr: {result.stderr.strip()}", file=sys.stderr)
            return False
        return True
    finally:
        os.remove(script_path)

def extract(input_pdf: str, output_json: str):
    print(f"[image_pdf_processor] Extracting text from {input_pdf}...", file=sys.stderr)
    
    # First attempt: Korean model
    success = _run_ocr_subprocess(input_pdf, output_json, use_korean=True)
    
    if not success:
        print(f"[image_pdf_processor] Korean model failed (possible segfault). Falling back to default model...", file=sys.stderr)
        # Second attempt: Default model
        success = _run_ocr_subprocess(input_pdf, output_json, use_korean=False)
        if not success:
            print(f"[image_pdf_processor] Default model also failed. Exiting.", file=sys.stderr)
            sys.exit(1)
            
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
            if text == "C":
                return True
            if re.match(r'^[\d\s/]+$', text):
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
