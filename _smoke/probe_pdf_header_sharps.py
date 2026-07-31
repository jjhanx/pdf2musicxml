#!/usr/bin/env python3
"""Probe clean_score PDF staff headers for sharp-like glyphs."""
import io
import re
import zipfile
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
SHARP_CHARS = {"#", "\u266f", "\uE262", "\uf062"}  # ASCII, ♯, SMuFL accidentalSharp (PUA)


def sharp_count_page(page) -> list[dict]:
    rect = page.rect
    header_x_max = rect.width * 0.28
    bands: dict[int, int] = {}
    rd = page.get_text("rawdict")
    for block in rd.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                y0 = int(span.get("bbox", [0, 0, 0, 0])[1] // 8) * 8
                for ch in span.get("chars", []):
                    c = ch.get("c", "")
                    x = ch.get("origin", ch.get("bbox", [0, 0, 0, 0]))[0]
                    if x > header_x_max:
                        continue
                    if c in SHARP_CHARS or (len(c) == 1 and ord(c) in range(0xE000, 0xF900)):
                        # Bravura accidentals often in PUA; count # and PUA in header
                        if c in SHARP_CHARS or ord(c) == 0xE262:
                            bands[y0] = bands.get(y0, 0) + 1
    out = sorted(({"y": y, "sharps": n} for y, n in bands.items()), key=lambda d: d["y"])
    return out


def main() -> int:
    for zname in ["omr-work-ddd2447d.zip", "omr-work-8317959f.zip"]:
        zpath = ROOT / zname
        if not zpath.is_file():
            continue
        with zipfile.ZipFile(zpath) as z:
            pdf_bytes = z.read("clean_score_only.pdf")
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        print("===", zname, "pages", doc.page_count, "===")
        for i in range(doc.page_count):
            bands = sharp_count_page(doc[i])
            if bands:
                print(f" page {i+1}:", bands[:12])
        doc.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
