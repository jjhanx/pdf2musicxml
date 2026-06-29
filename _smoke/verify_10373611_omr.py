#!/usr/bin/env python3
"""Verify omr-work-10373611: OMR raw rhythm unchanged by off-mode fix."""
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
OUT = "_smoke/10373611_verify.mxl"

PRINTED = [3, 8, 11, 12, 16, 19, 22, 25, 26, 27, 28, 29, 32, 36, 42, 43, 45, 46, 47, 48, 52, 57, 58, 59, 61]


def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        return ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()


def rhythm_sig(root, part_idx, mxl_num, staff=None):
    ns = fix.mxl_ns_uri(root)
    part = root.findall(".//" + fix.qname(ns, "part"))[part_idx]
    for measure, _, _ in fix._iter_measures_with_timing(part, ns):
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
        return tuple(rows)
    return None


def main():
    fix.fix_mxl_file(RAW, OUT)
    raw, off, rev = load(RAW), load(OUT), load(REV)
    diffs = 0
    for pm in PRINTED:
        mxl = pm - 1
        for pidx, label, st in [
            (1, "S", None),
            (2, "A", None),
            (3, "T", None),
            (4, "B", None),
            (4, "PR", "1"),
            (4, "PL", "2"),
        ]:
            r = rhythm_sig(raw, pidx, mxl, st)
            f = rhythm_sig(off, pidx, mxl, st)
            if r != f:
                diffs += 1
                print(f"FAIL m{pm} {label}: RAW!=OFF")
    if diffs:
        print(f"FAILED: {diffs} rhythm diffs RAW->OFF")
        sys.exit(1)
    print("OK: 10373611 OMR faithful (RAW==OFF rhythm)")


if __name__ == "__main__":
    main()
