import json
with open('debug-2596/extracted_music_text.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
p1 = data[0]
for t in p1.get('text_elements', [])[:15]:
    print(f"{t['raw_text']} -> ({t['x0']}, {t['y0']}, {t['x1']}, {t['y1']})")
