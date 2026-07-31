#!/usr/bin/env python3
"""Find music-font glyphs that would be stripped at 7-17pt across all pages."""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

import pikepdf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from pdf_separator import _effective_font_size_pt, font_size_in_ranges  # noqa: E402

PDF = ROOT / "청산에 살리라 F/청산에 살리라 F장조(이현철 곡).pdf"
RANGES = [(7.0, 17.0)]


def mul(a, b):
    return [
        a[0] * b[0] + a[2] * b[1],
        a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3],
        a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4],
        a[1] * b[4] + a[3] * b[5] + a[5],
    ]


def page_stats(page_idx: int, commands) -> tuple[Counter, Counter]:
    ctm_stack = [[1.0, 0.0, 0.0, 1.0, 0.0, 0.0]]
    current_font = ""
    current_font_size = 0.0
    tm = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
    stripped = Counter()
    kept = Counter()

    for operands, operator in commands:
        op = str(operator)
        if op == "q":
            ctm_stack.append(list(ctm_stack[-1]))
        elif op == "Q" and len(ctm_stack) > 1:
            ctm_stack.pop()
        elif op == "cm" and len(operands) >= 6:
            m2 = [float(operands[i]) for i in range(6)]
            ctm_stack[-1] = mul(ctm_stack[-1], m2)
        elif op == "BT":
            tm = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
        elif op == "Tf" and len(operands) > 1:
            current_font = str(operands[0])
            current_font_size = float(operands[1])
        elif op == "Tm" and len(operands) >= 6:
            tm = [float(operands[i]) for i in range(6)]

        if op not in ("Tj", "TJ", "'", '"') or not operands:
            continue
        eff = _effective_font_size_pt(current_font_size, ctm_stack[-1], tm)
        in_range = font_size_in_ranges(eff, RANGES)
        texts: list[str] = []
        if op == "TJ":
            for item in operands[0]:
                if isinstance(item, (int, float)):
                    continue
                texts.append(str(item))
        else:
            texts.append(str(operands[0]))
        for text in texts:
            for ch in text:
                if not ch.strip():
                    continue
                key = (current_font, round(eff, 2), page_idx + 1)
                if in_range:
                    stripped[key] += 1
                else:
                    kept[key] += 1
    return stripped, kept


def main() -> None:
    all_strip = Counter()
    with pikepdf.open(PDF) as pdf:
        for i, page in enumerate(pdf.pages):
            if "/Contents" not in page:
                continue
            try:
                commands = pikepdf.parse_content_stream(page)
            except Exception:
                continue
            stripped, _ = page_stats(i, commands)
            all_strip.update(stripped)
    print("Stripped glyph counts by font/size/page (music-looking fonts only):")
    for (font, sz, pg), n in all_strip.most_common(30):
        print(f"  p{pg} {font} {sz}pt x{n}")


if __name__ == "__main__":
    main()
