import fitz
import sys

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

def find_triplets():
    doc = fitz.open("d:/pdf2musicxml/original.pdf")
    print(f"Total pages: {len(doc)}")
    
    for page_idx, page in enumerate(doc):
        td = page.get_text("dict")
        found_in_page = 0
        for b in td.get("blocks", []):
            if b.get("type") != 0:
                continue
            for l in b.get("lines", []):
                for s in l.get("spans", []):
                    chars = s.get("chars", [])
                    if chars:
                        for ch in chars:
                            c = ch.get("c") or ""
                            if len(c) == 1 and ord(c) == 0xF073:
                                print(f"Page {page_idx+1}: char U+F073 at bbox {[round(x,1) for x in ch['bbox']]}, size {s['size']:.1f}")
                                found_in_page += 1
                    else:
                        txt = s.get("text") or ""
                        for i, c in enumerate(txt):
                            if ord(c) == 0xF073:
                                print(f"Page {page_idx+1}: text U+F073 at bbox s['bbox'], char index {i}")
                                found_in_page += 1
        if found_in_page > 0:
            print(f"Page {page_idx+1}: found {found_in_page} instances of U+F073")

if __name__ == "__main__":
    find_triplets()
