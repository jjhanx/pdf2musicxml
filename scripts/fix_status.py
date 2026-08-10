import sys

def main():
    try:
        with open('d:\\pdf2musicxml\\server\\index.ts', 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        return
        
    content = content.replace("    | 'deskew_needed'", "    | 'deskew_needed'\n    | 'deskew_save_needed'")

    with open('d:\\pdf2musicxml\\server\\index.ts', 'w', encoding='utf-8') as f:
        f.write(content)
        
    print("Added deskew_save_needed to JobStatus")

if __name__ == '__main__':
    main()