"""Glyph→staff-step report for a page region. Groups staff lines into staves.
Usage: probe_glyphs2.py <pdf> <page> <fx0> <fy0> <fx1> <fy1>"""
import sys

import fitz

pdf, pno = sys.argv[1], int(sys.argv[2])
fx0, fy0, fx1, fy1 = map(float, sys.argv[3:7])
doc = fitz.open(pdf)
page = doc[pno - 1]
r = page.rect
clip = fitz.Rect(r.width * fx0, r.height * fy0, r.width * fx1, r.height * fy1)

# collect staff lines (full-width horizontal)
ys = set()
for p in page.get_drawings():
    for item in p["items"]:
        if item[0] == "l":
            a, b = item[1], item[2]
            if abs(a.y - b.y) < 0.3 and clip.y0 - 20 <= a.y <= clip.y1 + 20 and abs(a.x - b.x) > 50:
                ys.add(round(a.y, 1))
        elif item[0] == "re":
            rect = item[1]
            if rect.height < 1.5 and rect.width > 50 and clip.y0 - 20 <= rect.y0 <= clip.y1 + 20:
                ys.add(round((rect.y0 + rect.y1) / 2, 1))
ys = sorted(ys)
# cluster into staves: consecutive lines with gap < 8
staves = []
for y in ys:
    if staves and y - staves[-1][-1] < 8:
        staves[-1].append(y)
    else:
        staves.append([y])
staves = [s for s in staves if len(s) == 5]
print("staves (top-line y):", [s[0] for s in staves])

d = page.get_text("rawdict", clip=clip, flags=fitz.TEXTFLAGS_TEXT)
chars = []
for block in d["blocks"]:
    for line in block.get("lines", []):
        for span in line.get("spans", []):
            for ch in span.get("chars", []):
                bbox = ch["bbox"]
                chars.append((bbox[0], (bbox[1] + bbox[3]) / 2, ord(ch["c"]), span.get("size", 0)))
chars.sort()
for x, cy, code, size in chars:
    best = None
    for i, s in enumerate(staves):
        mid = (s[0] + s[4]) / 2
        dist = abs(cy - mid)
        if best is None or dist < best[0]:
            best = (dist, i, s)
    if best is None:
        continue
    _, i, s = best
    gap = (s[4] - s[0]) / 4
    step = (cy - s[0]) / (gap / 2)  # 0=top line, increasing downward
    print(f"staff{i} U+{code:04X} x={x:7.1f} cy={cy:7.1f} step={step:5.1f} size={size:.1f}")
