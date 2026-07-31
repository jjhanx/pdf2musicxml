import re
with open(r'd:\pdf2musicxml\src\App.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

start = text.find("<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr'")
end = text.find('<div className="row dropzone-actions"')
print(start, end)
