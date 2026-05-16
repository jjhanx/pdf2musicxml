import sys
import json
import fitz

def mask_pdf(pdf_in, pdf_out, json_path):
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    doc = fitz.open(pdf_in)
    
    # Types to mask so Audiveris doesn't get confused (템포 문자는 검토 후 MusicXML에 주입)
    mask_types = {'title', 'composer', 'lyricist', 'copyright', 'lyrics', 'tempo'}
    
    for item in data:
        item_type = item.get('type', 'unknown')
        if item_type in mask_types:
            page_idx = item.get('page', 1) - 1
            bbox = item.get('bbox')
            if bbox and 0 <= page_idx < len(doc):
                page = doc[page_idx]
                rect = fitz.Rect(bbox)
                # Draw a white filled rectangle over the text
                page.draw_rect(rect, color=(1, 1, 1), fill=(1, 1, 1))
                
    doc.save(pdf_out)
    doc.close()

if __name__ == '__main__':
    if len(sys.argv) < 4:
        print("Usage: python mask_pdf.py <pdf_in> <pdf_out> <json_path>")
        sys.exit(1)
    mask_pdf(sys.argv[1], sys.argv[2], sys.argv[3])
