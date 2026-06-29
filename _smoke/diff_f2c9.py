#!/usr/bin/env python3
"""Diff raw vs fixed for f2c9 - show only changed measures."""
import io, re, sys, zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

CASES = [
    (2, 4, "1", "m3 PR"), (18, 1, None, "m19 S"), (18, 2, None, "m19 A"),
    (18, 3, None, "m19 T"), (18, 4, None, "m19 B"),
    (24, 1, None, "m25 S"), (24, 2, None, "m25 A"), (24, 3, None, "m25 T"),
    (24, 4, None, "m25 B"), (24, 4, "1", "m25 PR"), (24, 4, "2", "m25 PL"),
    (41, 1, None, "m42 S"), (41, 2, None, "m42 A"), (41, 4, "1", "m42 PR"),
    (41, 4, "2", "m42 PL"), (44, 4, "1", "m45 PR"), (44, 4, "2", "m45 PL"),
]

def load(p):
    with zipfile.ZipFile(p) as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        return ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()

def sig(root, part_idx, mnum, staff):
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
            stem = (n.find(fix.qname(ns, "stem")) or {}).text if n.find(fix.qname(ns, "stem")) is not None else "?"
            tm = n.find(fix.qname(ns, "time-modification")) is not None
            rows.append((t, d, p, beams, stem, tm))
        return tuple(rows)
    return None

raw = load("_smoke/omr-work-f2c9d2c6/audiveris_raw.mxl")
fixx = load("_smoke/f2c9_fixed.mxl")
rev = load("_smoke/omr-work-f2c9d2c6/review.mxl")

for mnum, pidx, staff, label in CASES:
    r, f, v = sig(raw, pidx, mnum, staff), sig(fixx, pidx, mnum, staff), sig(rev, pidx, mnum, staff)
    ch_rf = r != f
    ch_rv = r != v
    if ch_rf or ch_rv:
        print(f"\n{label} mxl{mnum}: raw->fix={'CHANGED' if ch_rf else 'same'} raw->rev={'CHANGED' if ch_rv else 'same'} fix->rev={'CHANGED' if f!=v else 'same'}")
        if ch_rf:
            for i, (a, b) in enumerate(zip(r, f)):
                if a != b:
                    print(f"  g{i}: {a} -> {b}")
            if len(r) != len(f):
                print(f"  group count {len(r)} -> {len(f)}")
