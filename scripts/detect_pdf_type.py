import sys
import fitz

def main():
    if len(sys.argv) < 2:
        print("Usage: python detect_pdf_type.py <input.pdf>")
        sys.exit(1)
        
    input_pdf = sys.argv[1]
    try:
        doc = fitz.open(input_pdf)
        total_text_len = 0
        for page in doc:
            text = page.get_text().strip()
            total_text_len += len(text)
            
        if total_text_len < 50:
            print("image_pdf")
        else:
            print("font_separator")
    except Exception:
        print("font_separator")
        sys.exit(0)

if __name__ == '__main__':
    main()
