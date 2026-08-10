import sys

def main():
    try:
        with open('d:\\pdf2musicxml\\server\\index.ts', 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        return

    # Fix const inputPdfPath
    content = content.replace("const inputPdfPath = job.inputPdfPath;", "let inputPdfPath = job.inputPdfPath;")
    
    # Fix JobStatus
    if "'deskew_save_needed'" not in content:
        content = content.replace("'deskew_needed'", "'deskew_needed'\n    | 'deskew_save_needed'")

    with open('d:\\pdf2musicxml\\server\\index.ts', 'w', encoding='utf-8') as f:
        f.write(content)
        
    print("Fixed TS errors")

if __name__ == '__main__':
    main()