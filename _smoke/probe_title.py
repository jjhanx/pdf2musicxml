#!/usr/bin/env python3
import json
import pikepdf
import pdfplumber

PDF = "original.pdf"

print("=== pdfplumber page 1 (~20.88pt or hangul) ===")
with pdfplumber.open(PDF) as pdf:
    for c in pdf.pages[0].chars:
        sz = float(c["size"])
        t = c.get("text", "")
        if abs(sz - 20.88) < 1.5 or t == "눈":
            print(
                f"  text={t!r} size={sz} font={c.get('fontname')} "
                f"bbox=({c['x0']:.1f},{c['y0']:.1f})"
            )

print("\n=== pikepdf page 1 content stream ===")
with pikepdf.open(PDF) as pdf:
    page = pdf.pages[0]
    cmds = pikepdf.parse_content_stream(page)
    fs = 0.0
    tm_a, tm_d = 1.0, 1.0
    for operands, op in cmds:
        opn = str(op)
        if opn == "Tf" and len(operands) > 1:
            fs = float(operands[1])
        if opn == "Tm" and len(operands) >= 6:
            tm_a = abs(float(operands[0]))
            tm_d = abs(float(operands[3]))
        if opn in ("Tj", "TJ", "'", '"'):
            txt = ""
            if opn == "TJ":
                for item in operands[0]:
                    if isinstance(item, pikepdf.String):
                        txt += str(item)
            elif operands:
                txt = str(operands[0])
            eff = fs * max(tm_a, tm_d)
            if txt.strip() and (eff > 15 or "눈" in txt or any("\uac00" <= ch <= "\ud7a3" for ch in txt)):
                print(f"  op={opn} text={txt[:30]!r} Tf={fs} Tm_scale=({tm_a},{tm_d}) eff~{eff:.2f}")

print("\n=== strip test ===")
import subprocess
import sys

out = "_smoke/clean_test.pdf"
subprocess.run(
    [sys.executable, "scripts/pdf_separator.py", "strip", PDF, out, "--ranges", "7-17,20.53-21.23"],
    check=True,
)
with pdfplumber.open(out) as pdf:
    hits = [c for c in pdf.pages[0].chars if c.get("text") == "눈" or abs(float(c["size"]) - 20.88) < 1]
    print(f"  after strip page1 title chars remaining: {len(hits)}")
    for c in hits[:5]:
        print(f"    {c.get('text')!r} size={c['size']}")
