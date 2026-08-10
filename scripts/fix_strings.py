import sys

def main():
    try:
        with open('d:\\pdf2musicxml\\server\\index.ts', 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        return
        
    content = content.replace("console.log(`[job ] Pausing for deskew save...`);", "console.log(`[job ${jobId}] Pausing for deskew save...`);")
    content = content.replace("console.log(`[job ] Deskew save confirmed, continuing...`);", "console.log(`[job ${jobId}] Deskew save confirmed, continuing...`);")
    content = content.replace("console.log([job ] Deskew save confirmed, continuing...);", "console.log(`[job ${jobId}] Deskew save confirmed, continuing...`);")

    with open('d:\\pdf2musicxml\\server\\index.ts', 'w', encoding='utf-8') as f:
        f.write(content)
        
    print("Fixed corrupted strings in index.ts")

if __name__ == '__main__':
    main()