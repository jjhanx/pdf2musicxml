import json
data = json.load(open('debug-2596/extracted_music_text.json', 'r', encoding='utf-8'))
for p in data:
    for t in p.get('text_elements', []):
        w = t['x1'] - t['x0']
        h = t['y1'] - t['y0']
        if w > 100 or h > 50:
            try:
                print(f"Huge box: '{t['raw_text']}' -> {w}x{h}")
            except Exception:
                print(f"Huge box: [unicode error] -> {w}x{h}")
