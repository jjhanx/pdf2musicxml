#!/usr/bin/env python3
"""Find where title text lives in PDF structure."""
import pikepdf
import pdfplumber

PDF = "original.pdf"


def walk_stream(stream, path="page", depth=0):
    try:
        cmds = pikepdf.parse_content_stream(stream)
    except Exception as e:
        print(f"  skip {path}: {e}")
        return
    fs = 0.0
    tm_a, tm_d = 1.0, 1.0
    current_font = ""
    for operands, op in cmds:
        opn = str(op)
        if opn == "Tf" and len(operands) > 1:
            current_font = str(operands[0])
            fs = float(operands[1])
        if opn == "Tm" and len(operands) >= 6:
            tm_a = abs(float(operands[0]))
            tm_d = abs(float(operands[3]))
        if opn == "Do" and operands:
            name = str(operands[0])
            print(f"{'  '*depth}XObject ref: {name} at {path}")
        if opn in ("Tj", "TJ", "'", '"'):
            txt = ""
            if opn == "TJ":
                for item in operands[0]:
                    if isinstance(item, pikepdf.String):
                        txt += str(item)
            elif operands:
                txt = str(operands[0])
            eff = fs * max(tm_a, tm_d)
            # CIDFont+F1 title is ~20.88 effective; look for F1 or small hangul-like CID
            if "F1" in current_font or (18 <= eff <= 24 and len(txt) <= 4):
                print(
                    f"{'  '*depth}[{path}] op={opn} font={current_font} Tf={fs:.2f} "
                    f"eff={eff:.2f} text={txt[:20]!r}"
                )


with pikepdf.open(PDF) as pdf:
    page = pdf.pages[0]
    print("=== Page content stream ===")
    walk_stream(page, "page/Contents")

    resources = page.get("/Resources", {})
    xobjs = resources.get("/XObject", {})
    if xobjs:
        print("\n=== XObjects ===")
        for name, xobj in xobjs.items():
            subtype = str(xobj.get("/Subtype", ""))
            print(f"  {name}: {subtype}")
            if subtype == "/Form":
                walk_stream(xobj, f"XObject/{name}", depth=1)

print("\n=== pdfplumber title bbox ===")
with pdfplumber.open(PDF) as pdf:
    for c in pdf.pages[0].chars:
        if c.get("text") == "눈":
            print(c)
