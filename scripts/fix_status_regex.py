import sys, re

def main():
    try:
        with open('d:\\pdf2musicxml\\server\\index.ts', 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        return

    content = re.sub(r"(\|\s*'deskew_needed')", r"\1\n  | 'deskew_save_needed'", content)

    with open('d:\\pdf2musicxml\\server\\index.ts', 'w', encoding='utf-8') as f:
        f.write(content)
        
    print("Fixed JobStatus via python regex")

if __name__ == '__main__':
    main()