#!/usr/bin/env python3
import pdfplumber
from collections import Counter

PDF = "original.pdf"
with pdfplumber.open(PDF) as pdf:
    for pnum, page in enumerate(pdf.pages, 1):
        texts = Counter()
        p_chars = []
        for c in page.chars:
            t = c.get("text", "")
            if t:
                texts[t] += 1
            if t in ("P", "p", "R", "L", "3", "2"):
                p_chars.append(
                    (t, round(float(c["size"]), 2), round(c["x0"], 1), round(c["y0"], 1))
                )
        if "P" in texts or "p" in texts or any(x[0] in "Pp" for x in p_chars):
            print(f"page {pnum} P/p counts", {k: texts[k] for k in texts if k in "PpRrLl323"})
            for row in sorted(p_chars, key=lambda z: (z[3], z[2]))[:30]:
                print(" ", row)
