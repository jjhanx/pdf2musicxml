#!/usr/bin/env python3
"""Compare raw vs fixed for reported measures."""
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

RAW = "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"
OUT = "_smoke/reg_audit.mxl"

# printed measure -> mxl number
CASES = [
    (18, "S", 1), (18, "A", 2), (18, "T", 3), (18, "B", 4),
    (24, "S", 1), (24, "A", 2), (24, "T", 3), (24, "B", 4),
    (41, "A", 2), (41, "T", 3), (41, "B", 4), (41, "PR", 4, "1"),
    (44, "S", 1), (44, "A", 2), (44, "T", 3), (44, "B", 4),
    (44, "PR", 4, "1"), (44, "PL", 4, "2"),
]


def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        return ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()


def dump_groups(root, part_idx, mnum, staff=None, label=""):
    ns = fix.mxl_ns_uri(root)
    part = root.findall(".//" + fix.qname(ns, "part"))[part_idx]
    for measure, div, exp in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != str(mnum):
            continue
        print(f"\n--- {label} part{part_idx+1} mxl{mnum} exp={exp} ---")
        gi = 0
        for g in fix._iter_chord_groups(measure, ns):
            if staff and g[2] != staff:
                continue
            n = g[0]
            p = n.find(fix.qname(ns, "pitch"))
            ps = "rest"
            if p is not None:
                step = p.find(fix.qname(ns, "step"))
                octv = p.find(fix.qname(ns, "octave"))
                ps = f"{step.text if step is not None else '?'}{octv.text if octv is not None else '?'}"
            if fix._is_rest(n, ns):
                ps = "R-" + (fix._note_type_text(n, ns) or "?")
            beams = [b.text for b in n.findall(fix.qname(ns, "beam"))]
            print(
                f" g{gi:2d} v{g[3]} {fix._note_type_text(n,ns):8s} d={fix._note_duration(n,ns):2d} "
                f"{ps:6s} b={beams} x={n.get('default-x','?')}"
            )
            gi += 1


fix.fix_mxl_file(RAW, OUT)
raw = load(RAW)
fixed = load(OUT)

for item in CASES:
    mnum, name, pi = item[0], item[1], item[2]
    staff = item[3] if len(item) > 3 else None
    dump_groups(raw, pi, mnum, staff, f"RAW {name} p{item[0]+1}")
    dump_groups(fixed, pi, mnum, staff, f"FIX {name} p{item[0]+1}")
