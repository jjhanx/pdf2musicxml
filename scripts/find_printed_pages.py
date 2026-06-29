import fitz
import sys

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

def find_printed_pages():
    doc = fitz.open("d:/pdf2musicxml/original.pdf")
    print(f"Total pages: {len(doc)}")
    
    for page_idx in range(len(doc)):
        page = doc[page_idx]
        text = page.get_text()
        print(f"\nPage {page_idx+1}:")
        lines = [line.strip() for line in text.split('\n') if line.strip()]
        # Print first 5 lines and any line containing numbers 13-18
        print("  First few lines:", lines[:5])
        for line in lines:
            if any(num in line for num in ["13", "14", "15", "16", "17", "18"]):
                print(f"  Matches: {line!r}")

if __name__ == "__main__":
    find_printed_pages()
