#!/usr/bin/env python3
"""Inspect PDF content stream effective font sizes on page 5."""
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


def main() -> None:
    with pikepdf.open(PDF) as pdf:
        page = pdf.pages[4]
        commands = pikepdf.parse_content_stream(page)
    ctm_stack = [[1.0, 0.0, 0.0, 1.0, 0.0, 0.0]]
    current_font = ""
    current_font_size = 0.0
    tm = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
    stripped_chars = Counter()
    kept_chars = Counter()

    def mul(a, b):
        return [
            a[0] * b[0] + a[2] * b[1],
            a[1] * b[0] + a[3] * b[1],
            a[0] * b[2] + a[2] * b[3],
            a[1] * b[2] + a[3] * b[3],
            a[0] * b[4] + a[2] * b[5] + a[4],
            a[1] * b[4] + a[3] * b[5] + a[5],
        ]

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
        if op == "TJ":
            arr = operands[0]
            for item in arr:
                if isinstance(item, (int, float)):
                    continue
                text = str(item)
                for ch in text:
                    if not ch.strip():
                        continue
                    key = (current_font[:20], round(eff, 2))
                    if in_range:
                        stripped_chars[key] += 1
                    else:
                        kept_chars[key] += 1
        else:
            text = str(operands[0])
            for ch in text:
                if not ch.strip():
                    continue
                key = (current_font[:20], round(eff, 2))
                if in_range:
                    stripped_chars[key] += 1
                else:
                    kept_chars[key] += 1

    print("Would STRIP (7-17pt effective):")
    for k, v in stripped_chars.most_common(15):
        print(" ", v, k)
    print("Would KEEP:")
    for k, v in kept_chars.most_common(15):
        print(" ", v, k)
    nwc_strip = sum(v for k, v in stripped_chars.items() if "NWC" in k[0])
    nwc_keep = sum(v for k, v in kept_chars.items() if "NWC" in k[0])
    print("NWC stripped", nwc_strip, "kept", nwc_keep)


if __name__ == "__main__":
    main()
