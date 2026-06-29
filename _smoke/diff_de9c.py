#!/usr/bin/env python3
"""Diff review.mxl vs fix output for de9c49e3."""
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

PATHS = {
    "raw": "_smoke/omr-work-de9c49e3/audiveris_raw.mxl",
    "fix": "_smoke/de9c_fixed.mxl",
    "rev": "_smoke/omr-work-de9c49e3/review.mxl",
}

MEASURES = [2, 18, 24, 41, 44]
PARTS = [(1, "S"), (2, "A"), (3, "T"), (4, "B"), (4, "PR", "1"), (4, "PL", "2")]


def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        return ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()


def sig(root, pi, mnum, staff=None):
    ns = fix.mxl_ns_uri(root)
    part = root.findall(".//" + fix.qname(ns, "part"))[pi]
    for measure, _, _ in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != str(mnum):
            continue
        bits = []
        for g in fix._iter_chord_groups(measure, ns):
            if staff and g[2] != staff:
                continue
            n = g[0]
            t = fix._note_type_text(n, ns) or "?"
            if fix._is_rest(n, ns):
                bits.append(f"R{t[0]}")
            else:
                ps = "+".join(sorted(fix._pitch_label(x, ns) or "?" for x in g[1]))
                tm = "t" if n.find(fix.qname(ns, "time-modification")) is not None else ""
                b = "B" if n.findall(fix.qname(ns, "beam")) else ""
                bits.append(f"{t[0]}{tm}{b}:{ps}")
        return "|".join(bits)
    return "?"


roots = {k: load(p) for k, p in PATHS.items()}

for mnum in MEASURES:
    print(f"\n=== mxl {mnum} (printed {mnum+1}) ===")
    for item in PARTS:
        pi, label = item[0], item[1]
        staff = item[2] if len(item) > 2 else None
        s_raw = sig(roots["raw"], pi, mnum, staff)
        s_fix = sig(roots["fix"], pi, mnum, staff)
        s_rev = sig(roots["rev"], pi, mnum, staff)
        if s_raw != s_fix or s_fix != s_rev or s_raw != s_rev:
            print(f" {label}:")
            if s_raw != s_fix:
                print(f"   raw->fix: {s_raw}")
                print(f"          : {s_fix}")
            if s_fix != s_rev:
                print(f"   fix->rev: {s_fix}")
                print(f"          : {s_rev}")
            if s_raw == s_fix and s_raw != s_rev:
                print(f"   (raw=fix, review differs)")
