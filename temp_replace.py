import sys

with open(r'd:\pdf2musicxml\chunk.txt', 'r', encoding='utf-8') as f:
    old_chunk = f.read()

with open(r'd:\pdf2musicxml\chunk_new.txt', 'r', encoding='utf-8') as f:
    new_chunk = f.read()

with open(r'd:\pdf2musicxml\src\App.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

if old_chunk in content:
    content = content.replace(old_chunk, new_chunk)
    with open(r'd:\pdf2musicxml\src\App.tsx', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Successfully replaced in App.tsx")
else:
    print("Failed to find old chunk in App.tsx")
