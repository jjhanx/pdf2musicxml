"""Detect staff lines and notehead centers in a cropped PNG.
Usage: measure_heads.py <png> [x0 x1]  (x range to search heads, in px)"""
import sys

import fitz  # noqa: F401  (ensures PyMuPDF avail; we use PIL-free numpy approach)
import numpy as np
from PIL import Image

img = np.array(Image.open(sys.argv[1]).convert("L"))
h, w = img.shape
dark = img < 128

# staff lines: rows where many dark pixels
row_counts = dark.sum(axis=1)
thresh = w * 0.5
line_rows = [y for y in range(h) if row_counts[y] > thresh]
# group adjacent
groups = []
for y in line_rows:
    if groups and y - groups[-1][-1] <= 2:
        groups[-1].append(y)
    else:
        groups.append([y])
lines = [sum(g) / len(g) for g in groups]
print("staff lines y:", [round(l, 1) for l in lines])
if len(lines) >= 2:
    gaps = [lines[i + 1] - lines[i] for i in range(len(lines) - 1)]
    print("gaps:", [round(g, 1) for g in gaps])

# heads: connected dark blobs wider than ~1.2 gap and roundish.
# simple column scan: for each x, find dark runs taller than 0.6*gap and shorter than 1.6*gap
gap = float(np.median([lines[i + 1] - lines[i] for i in range(len(lines) - 1)])) if len(lines) >= 2 else 25.0
from scipy import ndimage  # noqa: E402

lbl, n = ndimage.label(dark)
print("blobs:", n)
for i in range(1, n + 1):
    ys, xs = np.where(lbl == i)
    bh = ys.max() - ys.min() + 1
    bw = xs.max() - xs.min() + 1
    area = len(ys)
    # notehead-ish: width 1.0-2.2 gap, height 0.7-1.4 gap, dense
    if 0.8 * gap <= bw <= 2.4 * gap and 0.6 * gap <= bh <= 1.5 * gap and area > 0.4 * bw * bh:
        cy, cx = ys.mean(), xs.mean()
        # step position relative to top line: 0 = top line, 1 = next space, ...
        if lines:
            step = (cy - lines[0]) / (gap / 2)
            print(f"head? cx={cx:.0f} cy={cy:.0f} w={bw} h={bh} step_from_topline={step:.2f}")
