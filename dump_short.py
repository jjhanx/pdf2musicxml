import json
with open('debug-2596/extracted_music_text.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
for p in data:
    for t in p.get('text_elements', []):
        text = t['raw_text'].strip()
        if len(text) <= 3:
            print(f"Page {p['page_number']}: '{text}' -> ({t['x0']}, {t['y0']}, {t['x1']}, {t['y1']})")
