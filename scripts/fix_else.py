import sys

def main():
    try:
        with open('d:\\pdf2musicxml\\scripts\\deskew_processor.py', 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        return

    target = """            rotated_pix = fitz.Pixmap(fitz.csRGB, nW, nH, rotated_img.tobytes(), 0) # 0 for alpha
            out_page = out_doc.new_page(width=nW / zoom, height=nH / zoom)
            out_page.insert_image(out_page.rect, pixmap=rotated_pix)
            # If no rotation, just insert the page directly to preserve vector
            out_doc.insert_pdf(doc, from_page=page_idx, to_page=page_idx)"""
            
    replace = """            rotated_pix = fitz.Pixmap(fitz.csRGB, nW, nH, rotated_img.tobytes(), 0) # 0 for alpha
            out_page = out_doc.new_page(width=nW / zoom, height=nH / zoom)
            out_page.insert_image(out_page.rect, pixmap=rotated_pix)
        else:
            # If no rotation, just insert the page directly to preserve vector
            out_doc.insert_pdf(doc, from_page=page_idx, to_page=page_idx)"""
            
    if target in content:
        content = content.replace(target, replace)
        with open('d:\\pdf2musicxml\\scripts\\deskew_processor.py', 'w', encoding='utf-8') as f:
            f.write(content)
        print("Fixed else block")
    else:
        print("Target not found")

if __name__ == '__main__':
    main()