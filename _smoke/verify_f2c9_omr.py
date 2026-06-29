#!/usr/bin/env python3
"""f2c9: default (off) rhythm fix must leave OMR durations unchanged."""
import io
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

os.environ.pop("AUDIVERIS_MXL_RHYTHM_FIX", None)

sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix  # noqa: E402

RAW = "_smoke/omr-work-f2c9d2c6/audiveris_raw.mxl"
OUT = "_smoke/f2c9_off.mxl"

CASES = [
    (2, 4, "1", "m3 PR"),
    (18, 1, None, "m19 S"),
    (18, 2, None, "m19 A"),
    (24, 1, None, "m25 S"),
    (24, 2, None, "m25 A"),
    (24, 4, "1", "m25 PR"),
    (24, 4, "2", "m25 PL"),
    (41, 1, None, "m42 S"),
    (44, 4, "1", "m45 PR"),
    (44, 4, "2", "m45 PL"),
]


def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        return ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()


def rhythm_sig(root, part_idx, mnum, staff):
    ns = fix.mxl_ns_uri(root)
    part = root.findall(".//" + fix.qname(ns, "part"))[part_idx]
    for measure, _, _ in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != str(mnum):
            continue
        rows = []
        for g in fix._iter_chord_groups(measure, ns):
            if staff and g[2] != staff:
                continue
            n = g[0]
            t = fix._note_type_text(n, ns) or "?"
            d = fix._note_duration(n, ns)
            if fix._is_rest(n, ns):
                p = "R"
            else:
                p = "+".join(sorted(fix._pitch_label(x, ns) or "?" for x in g[1]))
            beams = tuple(b.text for b in n.findall(fix.qname(ns, "beam")))
            stem_el = n.find(fix.qname(ns, "stem"))
            stem = stem_el.text if stem_el is not None else "?"
            rows.append((t, d, p, beams, stem))
        return tuple(rows)
    return None


def main():
    fix.fix_mxl_file(RAW, OUT)
    assert fix._rhythm_fix_mode() == "off"
    raw_root = load(RAW)
    fixed_root = load(OUT)
    fails = []
    for mnum, pidx, staff, label in CASES:
        r = rhythm_sig(raw_root, pidx, mnum, staff)
        f = rhythm_sig(fixed_root, pidx, mnum, staff)
        if r != f:
            fails.append(f"{label}: rhythm changed under off mode")
    if fails:
        print("FAIL:")
        for x in fails:
            print(" ", x)
        sys.exit(1)
    print("OK: OMR rhythm preserved (off mode) for f2c9 key measures")


if __name__ == "__main__":
    main()
