import sys
import json
import os

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

def extract_and_mask_text(input_pdf_path, output_pdf_path, output_json_path):
    try:
        doc = fitz.open(input_pdf_path)
    except Exception as e:
        print(f"Error opening PDF: {e}", file=sys.stderr)
        sys.exit(1)

    print("Initializing EasyOCR reader (this may take a moment)...")
    # ko for Korean, en for English
    reader = easyocr.Reader(['ko', 'en'])

    all_text_data = []

    for page_num in range(len(doc)):
        page = doc[page_num]
        print(f"Processing page {page_num + 1}/{len(doc)}...")
        
        # Render page to image for OCR
        # We use a higher resolution (e.g., zoom=2) for better OCR accuracy
        zoom = 2
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False, colorspace=fitz.csRGB)
        
        # Convert pixmap to numpy array for EasyOCR
        img_np = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, 3)
        
        # Run EasyOCR
        results = reader.readtext(img_np)
        
        page_text_data = []
        for (bbox, text, prob) in results:
            # Filter low confidence or very short/empty text
            # Music notes/lines might be misidentified as text with very low confidence
            text = text.strip()
            if not text or prob < 0.3:
                continue
                
            # Bbox from EasyOCR is [[x1, y1], [x2, y1], [x2, y2], [x1, y2]] in scaled image coordinates
            # We need to map it back to original PDF coordinates by dividing by zoom
            x0 = min(p[0] for p in bbox) / zoom
            y0 = min(p[1] for p in bbox) / zoom
            x1 = max(p[0] for p in bbox) / zoom
            y1 = max(p[1] for p in bbox) / zoom
            
            # Create a PyMuPDF Rect. Add a slight padding to ensure the whole text is masked
            pad = 2
            rect = fitz.Rect(max(0, x0 - pad), max(0, y0 - pad), x1 + pad, y1 + pad)
            
            # Store data
            page_text_data.append({
                "text": text,
                "bbox": [rect.x0, rect.y0, rect.x1, rect.y1]
            })
            
            # Mask the text with a white rectangle
            # We use draw_rect with fill color white
            page.draw_rect(rect, color=(1, 1, 1), fill=(1, 1, 1), overlay=True)

        all_text_data.append({
            "page": page_num + 1,
            "blocks": page_text_data
        })

    # Save masked PDF
    doc.save(output_pdf_path)
    doc.close()

    # Save text data to JSON
    with open(output_json_path, 'w', encoding='utf-8') as f:
        json.dump(all_text_data, f, ensure_ascii=False, indent=2)

    print(f"Success. Extracted text to {output_json_path} and masked PDF to {output_pdf_path}")

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python pdf_text_extractor.py <input.pdf> <masked_output.pdf> <text_data.json>", file=sys.stderr)
        sys.exit(1)
    
    input_pdf = sys.argv[1]
    output_pdf = sys.argv[2]
    output_json = sys.argv[3]
    
    extract_and_mask_text(input_pdf, output_pdf, output_json)
