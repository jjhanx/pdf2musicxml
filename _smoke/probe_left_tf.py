#!/usr/bin/env python3
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


with pikepdf.open(PDF) as pdf:
    page = pdf.pages[0]
    cmds = pikepdf.parse_content_stream(page)
    ctm_stack = [[1.0, 0.0, 0.0, 1.0, 0.0, 0.0]]
    fs = 0.0
    tm = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
    for operands, op in cmds:
        opn = str(op)
        if opn == "q":
            ctm_stack.append(list(ctm_stack[-1]))
        elif opn == "Q" and len(ctm_stack) > 1:
            ctm_stack.pop()
        elif opn == "cm" and len(operands) >= 6:
            m2 = [float(operands[i]) for i in range(6)]
            ctm_stack[-1] = multiply_matrix(ctm_stack[-1], m2)
        elif opn == "Tf" and len(operands) > 1:
            fs = float(operands[1])
        elif opn == "Tm" and len(operands) >= 6:
            tm = [float(operands[i]) for i in range(6)]
        elif opn in ("Tj", "TJ") and fs > 0:
            x = float(tm[4])
            eff = fs * max(abs(ctm_stack[-1][0]), abs(ctm_stack[-1][3])) * max(abs(tm[0]), abs(tm[3]))
            if x < 85:
                txt = ""
                if opn == "TJ":
                    for item in operands[0]:
                        if isinstance(item, pikepdf.String):
                            txt += str(item)
                else:
                    txt = str(operands[0])
                if txt.strip():
                    print(f"x={x:.1f} eff={eff:.2f} Tf={fs:.2f} raw={txt!r}")
