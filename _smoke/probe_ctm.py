#!/usr/bin/env python3
import pikepdf

PDF = "original.pdf"
with pikepdf.open(PDF) as pdf:
    cmds = pikepdf.parse_content_stream(pdf.pages[0])
    ctm = [1, 0, 0, 1, 0, 0]
    fs = 0.0
    font = ""
    tm = [1, 0, 0, 1, 0, 0]
    in_text = False

    def ctm_scale(ctm):
        return max(abs(ctm[0]), abs(ctm[3]))

    for i, (operands, op) in enumerate(cmds):
        opn = str(op)
        if opn == "cm" and len(operands) >= 6:
            # multiply ctm - simplified: just track diagonal for axis-aligned
            a, b, c, d, e, f = [float(x) for x in operands[:6]]
            na = ctm[0] * a + ctm[1] * c
            nb = ctm[0] * b + ctm[1] * d
            nc = ctm[2] * a + ctm[3] * c
            nd = ctm[2] * b + ctm[3] * d
            ctm = [na, nb, nc, nd, 0, 0]  # skip translation for scale probe
        if opn == "q":
            pass
        if opn == "BT":
            in_text = True
            tm = [1, 0, 0, 1, 0, 0]
        if opn == "ET":
            in_text = False
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
            eff_tf = fs
            eff_tm = fs * max(abs(tm[0]), abs(tm[3]))
            eff_ctm = fs * ctm_scale(ctm) * max(abs(tm[0]), abs(tm[3]))
            print(
                f"#{i} F1 TJ ctm_scale={ctm_scale(ctm):.4f} Tf={fs:.2f} "
                f"Tm_diag=({tm[0]:.2f},{tm[3]:.2f}) eff_ctm={eff_ctm:.2f} raw={txt!r}"
            )
        if opn in ("Tj", "TJ") and font == "/F3" and i < 30:
            eff_ctm = fs * ctm_scale(ctm) * max(abs(tm[0]), abs(tm[3]))
            print(f"#{i} F3 sample eff_ctm={eff_ctm:.2f}")
