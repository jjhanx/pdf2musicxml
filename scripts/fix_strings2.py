import sys

def main():
    try:
        with open('d:\\pdf2musicxml\\server\\index.ts', 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        return
        
    content = content.replace("console.log([job ] Pausing for deskew save...);", "console.log(`[job ${jobId}] Pausing for deskew save...`);")
    content = content.replace("console.log(`[job ${jobId}] Deskew save confirmed, continuing...`);\n\n      console.log(`[job ${jobId}] Pausing for early part label setup", "console.log(`[job ${jobId}] Deskew save confirmed, continuing...`);\n\n      console.log(`[job ${jobId}] Pausing for early part label setup") # Deduplicate? Wait, let's just make sure strings are right.

    with open('d:\\pdf2musicxml\\server\\index.ts', 'w', encoding='utf-8') as f:
        f.write(content)
        
    print("Fixed corrupted strings in index.ts again")

if __name__ == '__main__':
    main()