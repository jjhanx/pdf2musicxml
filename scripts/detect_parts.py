import fitz
import sys
import json
import re

PART_NAMES = ["Soprano", "Alto", "Tenor", "Bass", "S", "A", "T", "B", "Sop", "Ten", "SA", "TB", "SopranoAlto", "TenorBass"]

def detect_parts(pdf_path: str) -> list[str]:
    doc = fitz.open(pdf_path)
    if not doc:
        return []
        
    page = doc[0]
    rect = page.rect
    
    # Check the left 20% of the page
    clip_rect = fitz.Rect(0, 0, rect.width * 0.2, rect.height)
    
    # Get text dict
    text_dict = page.get_text("dict", clip=clip_rect)
    
    detected = []
    
    # Simple heuristic: Look for blocks that match common part names
    blocks = text_dict.get("blocks", [])
    
    # Sort blocks by y coordinate to maintain top-to-bottom order
    blocks.sort(key=lambda b: b.get("bbox", [0,0,0,0])[1])
    
    for b in blocks:
        if b.get("type") == 0:  # text
            for line in b.get("lines", []):
                for span in line.get("spans", []):
                    text = span.get("text", "").strip()
                    if not text:
                        continue
                        
                    bbox = span.get("bbox", [0,0,0,0])
                    y_center = (bbox[1] + bbox[3]) / 2
                    
                    # Remove some noise characters
                    clean_text = re.sub(r'[^a-zA-Z]', '', text)
                    if clean_text in PART_NAMES or any(clean_text.startswith(p) for p in ["Soprano", "Alto", "Tenor", "Bass"]):
                        if not any(d["label"] == clean_text for d in detected):
                            detected.append({
                                "label": clean_text,
                                "y_center": y_center
                            })
                            
    return detected

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python detect_parts.py <pdf_path>")
        sys.exit(1)
        
    parts = detect_parts(sys.argv[1])
    print(json.dumps(parts))
