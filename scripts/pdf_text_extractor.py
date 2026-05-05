import sys
import json
import os

try:
    import fitz  # PyMuPDF
except ImportError:
    print("Error: PyMuPDF is not installed. Please run: pip install PyMuPDF", file=sys.stderr)
    sys.exit(1)

def extract_and_mask_text(input_pdf_path, output_pdf_path, output_json_path):
    try:
        doc = fitz.open(input_pdf_path)
    except Exception as e:
        print(f"Error opening PDF: {e}", file=sys.stderr)
        sys.exit(1)

    all_text_data = []

    for page_num in range(len(doc)):
        page = doc[page_num]
        
        # Get dictionary of all text blocks
        # block = (x0, y0, x1, y1, "lines in block", block_no, block_type)
        # block_type 0 is text, 1 is image.
        blocks = page.get_text("blocks")
        
        page_text_data = []
        for b in blocks:
            if b[6] == 0:  # text block
                text = b[4].strip()
                if not text:
                    continue
                
                rect = fitz.Rect(b[:4])
                
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
