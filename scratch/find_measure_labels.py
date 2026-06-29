import fitz # PyMuPDF

doc = fitz.open("눈\xa0김효근\xa04부\xa010쪽.pdf")
print("Total pages:", len(doc))

# Let's extract text and look for numbers that look like measure numbers (usually at the start of systems)
for page_num in range(len(doc)):
    page = doc[page_num]
    text_instances = page.get_text("blocks")
    # Sort blocks by vertical then horizontal position
    text_instances.sort(key=lambda b: (b[1], b[0]))
    print(f"\n--- Page {page_num + 1} ---")
    for block in text_instances:
        text = block[4].strip()
        # Look for small numbers at the left side of the page (usually measure numbers)
        if text.isdigit():
            val = int(text)
            if val < 70:
                print(f"Number block: '{text}' at x={block[0]:.1f}, y={block[1]:.1f}")
        elif len(text) < 10 and any(c.isdigit() for c in text):
            print(f"Short text block: '{text.encode('utf-8')}' at x={block[0]:.1f}, y={block[1]:.1f}")
