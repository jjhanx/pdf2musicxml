#!/usr/bin/env python3
"""Audit dda9b3f0: raw vs off-fix vs review; find rhythm/rest changes."""
import io
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

os.environ.pop("AUDIVERIS_MXL_RHYTHM_FIX", None)
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

RAW = "_smoke/omr-work-dda9b3f0/audiveris_raw.mxl"
REV = "_smoke/omr-work-dda9b3f0/review.mxl"
OUT = "_smoke/dda9_off.mxl"

# printed measure -> mxl number
PRINTED = [3, 8, 11, 12, 13, 16, 19, 22, 25, 26, 27, 28, 29, 31, 36, 42, 43, 45, 46, 47, 48, 52, 58, 61]


def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        return ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()


def part_groups(root, part_idx, mxl_num, staff=None):
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
            if fix._is_rest(n, ns):
                p = "R-" + t
            else:
                p = "+".join(sorted(fix._pitch_label(x, ns) or "?" for x in g[1]))
            rows.append((t, d, p, g[3]))
        return rows, exp
    return None, None


def tail_sig(rows):
    if not rows:
        return None
    t, d, p, v = rows[-1]
    return (t, p, v)


def main():
    fix.fix_mxl_file(RAW, OUT)
    raw, off, rev = load(RAW), load(OUT), load(REV)
    parts = {"S": 1, "A": 2, "T": 3, "B": 4, "PR": (4, "1"), "PL": (4, "2")}

    print("=== trailing rest / rhythm diff (printed measures) ===\n")
    changes_off = changes_rev = 0
    for pm in PRINTED:
        mxl = pm - 1
        for label, pidx in [("S", 1), ("A", 2), ("T", 3), ("B", 4)]:
            r, _ = part_groups(raw, pidx, mxl)
            f, _ = part_groups(off, pidx, mxl)
            v, _ = part_groups(rev, pidx, mxl)
            if r != f:
                changes_off += 1
                print(f"m{pm} {label}: RAW->OFF changed  tail RAW={tail_sig(r)} OFF={tail_sig(f)}")
            if r != v:
                changes_rev += 1
                if r == f:
                    print(f"m{pm} {label}: RAW->REV changed (OFF=same) tail RAW={tail_sig(r)} REV={tail_sig(v)}")
        for label, pidx, st in [("PR", 4, "1"), ("PL", 4, "2")]:
            r, _ = part_groups(raw, pidx, mxl, st)
            f, _ = part_groups(off, pidx, mxl, st)
            v, _ = part_groups(rev, pidx, mxl, st)
            if r != f:
                changes_off += 1
                print(f"m{pm} {label}: RAW->OFF changed  tail RAW={tail_sig(r)} OFF={tail_sig(f)}")
            if r != v:
                changes_rev += 1
                if r == f:
                    print(f"m{pm} {label}: RAW->REV changed (OFF=same) tail RAW={tail_sig(r)} REV={tail_sig(v)}")

    print(f"\nTotal RAW!=OFF: {changes_off}, RAW!=REV (OFF same): {changes_rev - changes_off}")


if __name__ == "__main__":
    main()
