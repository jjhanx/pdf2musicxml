#!/usr/bin/env python3
"""Compare pdfplumber bucket sizes vs pikepdf effective sizes (Tf*CTM*Tm)."""
import json
from collections import defaultdict

import pdfplumber
import pikepdf

PDF = "original.pdf"


def multiply_matrix(m1, m2):
    a1, b1, c1, d1, e1, f1 = m1
    a2, b2, c2, d2, e2, f2 = m2
    return [
        a1 * a2 + b1 * c2,
        a1 * b2 + b1 * d2,
        c1 * a2 + d1 * c2,
        c1 * b2 + d1 * d2,
        a1 * e2 + b1 * f2 + e1,
        c1 * e2 + d1 * f2 + f1,
    ]


def eff_scale(ctm, tm):
    return max(abs(ctm[0]), abs(ctm[3])) * max(abs(tm[0]), abs(tm[3]))


def scan_page(page):
    cmds = pikepdf.parse_content_stream(page)
    ctm_stack = [[1, 0, 0, 1, 0, 0]]
    fs = 0.0
    tm = [1, 0, 0, 1, 0, 0]
    eff_sizes = []
    for operands, op in cmds:
        opn = str(op)
        if opn == "q":
            ctm_stack.append(list(ctm_stack[-1]))
        elif opn == "Q" and len(ctm_stack) > 1:
            ctm_stack.pop()
        elif opn == "cm" and len(operands) >= 6:
            m2 = [float(x) for x in operands[:6]]
            ctm_stack[-1] = multiply_matrix(ctm_stack[-1], m2)
        elif opn == "BT":
            tm = [1, 0, 0, 1, 0, 0]
        elif opn == "Tf" and len(operands) > 1:
            fs = float(operands[1])
        elif opn == "Tm" and len(operands) >= 6:
            tm = [float(x) for x in operands[:6]]
        elif opn in ("Tj", "TJ", "'", '"') and fs > 0:
            eff = fs * eff_scale(ctm_stack[-1], tm)
            eff_sizes.append(round(eff, 2))
    return eff_sizes


plumber_sizes = defaultdict(int)
with pdfplumber.open(PDF) as pdf:
    for page in pdf.pages:
        for c in page.chars:
            if c.get("text", "").strip():
                plumber_sizes[round(float(c["size"]), 2)] += 1

pike_sizes = defaultdict(int)
with pikepdf.open(PDF) as pdf:
    for page in pdf.pages:
        for s in scan_page(page):
            pike_sizes[s] += 1

print("pdfplumber unique sizes:", sorted(plumber_sizes.keys()))
print("pikepdf effective sizes:", sorted(pike_sizes.keys()))
print("\nOnly in plumber (CTM mismatch):", sorted(set(plumber_sizes) - set(pike_sizes)))
print("Only in pike:", sorted(set(pike_sizes) - set(plumber_sizes)))
