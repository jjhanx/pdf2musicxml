"""List music-font glyphs and staff line ys in a page region.
Usage: probe_glyphs.py <pdf> <page> <fx0> <fy0> <fx1> <fy1>"""
import sys

import fitz

pdf, pno = sys.argv[1], int(sys.argv[2])
fx0, fy0, fx1, fy1 = map(float, sys.argv[3:7])
doc = fitz.open(pdf)
page = doc[pno - 1]
r = page.rect
clip = fitz.Rect(r.width * fx0, r.height * fy0, r.width * fx1, r.height * fy1)

d = page.get_text("rawdict", clip=clip, flags=fitz.TEXTFLAGS_TEXT)
chars = []
for block in d["blocks"]:
    for line in block.get("lines", []):
        for span in line.get("spans", []):
            font = span.get("font", "?")
            size = span.get("size", 0)
            for ch in span.get("chars", []):
                c = ch["c"]
                bbox = ch["bbox"]
                chars.append((bbox[0], bbox[1], bbox[2], bbox[3], ord(c), font, size))
chars.sort()
for x0, y0, x1, y1, code, font, size in chars:
    print(f"U+{code:04X} x={x0:7.1f}..{x1:7.1f} y={y0:7.1f}..{y1:7.1f} cy={(y0+y1)/2:7.1f} {font} {size:.1f}")

# staff lines from drawings: horizontal lines in clip
lines = set()
for p in page.get_drawings():
    for item in p["items"]:
        if item[0] == "l":
            a, b = item[1], item[2]
            if abs(a.y - b.y) < 0.3 and clip.y0 <= a.y <= clip.y1 and a.x < clip.x1 and b.x > clip.x0:
                lines.add(round(a.y, 1))
        elif item[0] == "re":
            rect = item[1]
            if rect.height < 1.5 and clip.y0 <= rect.y0 <= clip.y1 and rect.x0 < clip.x1 and rect.x1 > clip.x0:
                lines.add(round((rect.y0 + rect.y1) / 2, 1))
print("hlines y:", sorted(lines))
