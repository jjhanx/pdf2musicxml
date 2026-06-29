#!/usr/bin/env python3
"""Left-margin text that may confuse Audiveris (part names)."""
import pdfplumber

PDF = "original.pdf"
with pdfplumber.open(PDF) as pdf:
    for pnum, page in enumerate(pdf.pages, 1):
        left = []
        for c in page.chars:
            x = float(c["x0"])
            if x > 80:
                continue
            t = c.get("text", "").strip()
            if not t:
                continue
            left.append(
                (
                    t,
                    round(float(c["size"]), 2),
                    round(x, 1),
                    round(float(c["y0"]), 1),
                    c.get("fontname", ""),
                )
            )
        if left:
            print(f"\npage {pnum} left margin (x<=80) {len(left)} chars")
            for row in sorted(left, key=lambda z: (z[3], z[2]))[:60]:
                print(f"  {row}")
