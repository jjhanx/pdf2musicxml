import sys, re

def main():
    try:
        with open('d:\\pdf2musicxml\\server\\index.ts', 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        return

    content = content.replace("?섑룊 蹂댁젙 寃곌낵 ?앹꽦 以?..", "수평 보정 결과 생성 중...")
    
    with open('d:\\pdf2musicxml\\server\\index.ts', 'w', encoding='utf-8') as f:
        f.write(content)
        
    print("Fixed all Korean strings")

if __name__ == '__main__':
    main()