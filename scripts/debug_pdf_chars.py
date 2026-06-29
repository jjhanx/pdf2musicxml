import fitz
import sys

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

def debug_pdf_chars():
    doc = fitz.open("d:/pdf2musicxml/original.pdf")
    print(f"PDF page count: {len(doc)}")
    
    out_lines = []
    for page_idx, page in enumerate(doc):
        out_lines.append(f"\n--- Page {page_idx + 1} ---")
        td = page.get_text("dict")
        for b_idx, b in enumerate(td.get("blocks", [])):
            if b.get("type") != 0:
                continue
            for l_idx, l in enumerate(b.get("lines", [])):
                for s_idx, s in enumerate(l.get("spans", [])):
                    font = s.get("font")
                    size = s.get("size")
                    text = s.get("text")
                    bbox = s.get("bbox")
                    
                    chars = s.get("chars", [])
                    char_details = []
                    for ch in chars:
                        c = ch.get("c") or ""
                        c_bbox = ch.get("bbox")
                        char_details.append(f"'{c}'(U+{ord(c):04X},bbox={[round(x,1) for x in c_bbox]})")
                    
                    out_lines.append(f"Block {b_idx}, Line {l_idx}, Span {s_idx}:")
                    out_lines.append(f"  Font: {font}, Size: {size:.2f}, Text: {text!r}")
                    out_lines.append(f"  Bbox: {[round(x,1) for x in bbox]}")
                    if char_details:
                        out_lines.append(f"  Chars: {', '.join(char_details)}")
                        
    with open("d:/pdf2musicxml/debug_chars.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(out_lines))
    print("Completed. Wrote to debug_chars.txt")

if __name__ == "__main__":
    debug_pdf_chars()
