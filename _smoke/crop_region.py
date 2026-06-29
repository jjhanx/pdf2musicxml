"""Crop a region of a PDF page to PNG. Args: pdf page x0 y0 x1 y1 out [dpi]
Coordinates are fractions of page width/height (0..1)."""
import sys

import fitz

pdf, page_num = sys.argv[1], int(sys.argv[2])
fx0, fy0, fx1, fy1 = map(float, sys.argv[3:7])
out = sys.argv[7]
dpi = int(sys.argv[8]) if len(sys.argv) > 8 else 250
doc = fitz.open(pdf)
page = doc[page_num - 1]
r = page.rect
clip = fitz.Rect(r.width * fx0, r.height * fy0, r.width * fx1, r.height * fy1)
pix = page.get_pixmap(dpi=dpi, clip=clip)
pix.save(out)
print(out, pix.width, pix.height)
