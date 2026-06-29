#!/usr/bin/env python3
"""Find part labels (S,A,T,B,PR,PL,P,R,L) in PDF pages."""
import sys
from collections import defaultdict

import pdfplumber

PDF = sys.argv[1] if len(sys.argv) > 1 else "original.pdf"
LABEL_CHARS = set("SATBPRLO")


def scan(path: str) -> None:
    print(f"=== {path} ===")
    with pdfplumber.open(path) as pdf:
        for pnum, page in enumerate(pdf.pages, 1):
            by_size: dict[float, list] = defaultdict(list)
            for c in page.chars:
                t = c.get("text", "")
                if not t or t not in LABEL_CHARS:
                    continue
                sz = round(float(c["size"]), 2)
                by_size[sz].append(
                    (t, round(c["x0"], 1), round(c["y0"], 1), c.get("fontname", ""))
                )
            if not by_size:
                continue
            print(f"page {pnum}:")
            for sz in sorted(by_size.keys()):
                items = by_size[sz]
                print(f"  size {sz}pt count={len(items)} fonts={sorted({x[3] for x in items})}")
                # cluster by y (same line)
                for t, x, y, fn in sorted(items, key=lambda z: (z[2], z[1]))[:25]:
                    print(f"    {t!r} x={x} y={y} {fn}")
                if len(items) > 25:
                    print(f"    ... +{len(items)-25} more")


for p in [PDF, "masked-input.pdf", "_smoke/clean_test.pdf"]:
    try:
        scan(p)
    except Exception as e:
        print(f"skip {p}: {e}")
