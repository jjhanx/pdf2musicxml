#!/usr/bin/env python3
import pikepdf

PDF = "original.pdf"
with pikepdf.open(PDF) as pdf:
    cmds = pikepdf.parse_content_stream(pdf.pages[0])
    fs = 0.0
    font = ""
    tm = [1, 0, 0, 1, 0, 0]
    for i, (operands, op) in enumerate(cmds):
        opn = str(op)
        if opn == "Tf":
            font = str(operands[0])
            fs = float(operands[1])
        if opn == "Tm" and len(operands) >= 6:
            tm = [float(x) for x in operands[:6]]
        if opn in ("Tj", "TJ") and font == "/F1":
            txt = ""
            if opn == "TJ":
                for item in operands[0]:
                    if isinstance(item, pikepdf.String):
                        txt += str(item)
            else:
                txt = str(operands[0])
            eff = fs * max(abs(tm[0]), abs(tm[3]))
            print(f"#{i} {opn} font={font} Tf={fs} Tm={tm} eff={eff:.2f} raw={txt!r}")
