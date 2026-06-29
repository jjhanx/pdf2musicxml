#!/usr/bin/env python3
"""Audit omr-work-10373611: raw vs off-fix vs review for user-reported measures."""
import io
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

os.environ.pop("AUDIVERIS_MXL_RHYTHM_FIX", None)
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

RAW = "_smoke/omr-work-10373611/audiveris_raw.mxl"
REV = "_smoke/omr-work-10373611/review.mxl"
OUT = "_smoke/10373611_off.mxl"

PRINTED = [3, 8, 11, 12, 16, 19, 22, 25, 26, 27, 28, 29, 32, 36, 42, 43, 45, 46, 47, 48, 52, 57, 58, 59, 61]
PARTS = {
    "S": (1, None),
    "A": (2, None),
    "T": (3, None),
    "B": (4, None),
    "PR": (4, "1"),
    "PL": (4, "2"),
}


def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        return ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()


def sig_rows(root, part_idx, mxl_num, staff=None):
    ns = fix.mxl_ns_uri(root)
    part = root.findall(".//" + fix.qname(ns, "part"))[part_idx]
    for measure, div, exp in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != str(mxl_num):
            continue
        rows = []
        for g in fix._iter_chord_groups(measure, ns):
            if staff and g[2] != staff:
                continue
            n = g[0]
            t = fix._note_type_text(n, ns) or "?"
            d = fix._note_duration(n, ns)
            beams = [b.text for b in n.findall(fix.qname(ns, "beam"))]
            tm = n.find(fix.qname(ns, "time-modification"))
            tup = "T" if tm is not None else ""
            if fix._is_rest(n, ns):
                p = "R-" + t
            else:
                p = "+".join(sorted(fix._pitch_label(x, ns) or "?" for x in g[1]))
            rows.append((t, d, p, g[3], "".join(beams or []), tup))
        return rows, exp
    return None, None


def fmt_row(i, r):
    t, d, p, v, b, tup = r
    return f"  #{i+1} v{v} {t:8s} d={d} {p} beam={b or '-'} {tup}"


def main():
    fix.fix_mxl_file(RAW, OUT)
    raw, off, rev = load(RAW), load(OUT), load(REV)

    raw_only_q = post_only_q = rev_only_q = 0
    raw_off_diff = raw_rev_diff = off_rev_diff = 0

    print("=== 8th->quarter pattern audit (printed measures) ===\n")
    for pm in PRINTED:
        mxl = pm - 1
        for label, (pidx, staff) in PARTS.items():
            r, _ = sig_rows(raw, pidx, mxl, staff)
            f, _ = sig_rows(off, pidx, mxl, staff)
            v, _ = sig_rows(rev, pidx, mxl, staff)
            if r is None:
                continue
            if r != f:
                raw_off_diff += 1
                print(f"--- printed m{pm} {label}: RAW != OFF ---")
                for i, (a, b) in enumerate(zip(r, f)):
                    if a != b:
                        print(f"  idx {i+1}: RAW {a[:4]} -> OFF {b[:4]}")
            if r != v:
                raw_rev_diff += 1
                if r == f:
                    print(f"--- printed m{pm} {label}: RAW == OFF != REV ---")
                    for i in range(max(len(r), len(v))):
                        a = r[i] if i < len(r) else None
                        b = v[i] if i < len(v) else None
                        if a != b:
                            print(f"  idx {i+1}: RAW {a[:4] if a else None} -> REV {b[:4] if b else None}")
            if f != v:
                off_rev_diff += 1

            # detect quarter where user expects 8th at position 1 (2nd note)
            for tag, rows in [("RAW", r), ("OFF", f), ("REV", v)]:
                if len(rows) >= 2 and rows[1][0] == "quarter" and not rows[1][2].startswith("R-"):
                    if tag == "RAW":
                        raw_only_q += 1
                    elif tag == "REV" and r[1][0] != "quarter":
                        post_only_q += 1

    print(f"\nSummary:")
    print(f"  RAW!=OFF diffs: {raw_off_diff}")
    print(f"  RAW!=REV (OFF same): {raw_rev_diff - raw_off_diff}")
    print(f"  OFF!=REV: {off_rev_diff}")
    print(f"  2nd-note quarter in RAW: {raw_only_q} part-measures")
    print(f"  2nd-note quarter introduced post-RAW: {post_only_q}")


if __name__ == "__main__":
    main()
