#!/usr/bin/env python3
import io, re, sys, zipfile
import xml.etree.ElementTree as ET
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

RAW = "_smoke/omr-work-10373611/audiveris_raw.mxl"

CASES = [
    (8, "S", 1, None), (11, "S", 1, None), (12, "S", 1, None),
    (16, "B", 4, None), (19, "S", 1, None), (19, "T", 3, None),
    (25, "T", 3, None), (25, "PR", 4, "1"), (25, "PL", 4, "2"),
    (45, "PR", 4, "1"), (45, "PL", 4, "2"), (57, "S", 1, None),
    (61, "PR", 4, "1"), (61, "S", 1, None),
    (3, "PR", 4, "1"),
]

def load(p):
    with zipfile.ZipFile(p) as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        return ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()

root = load(RAW)
ns = fix.mxl_ns_uri(root)

for pm, label, pidx, staff in CASES:
    mxl = pm - 1
    part = root.findall(".//" + fix.qname(ns, "part"))[pidx]
    for measure, div, exp in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != str(mxl):
            continue
        print(f"\n=== printed m{pm} {label} (mxl {mxl}) exp={exp} div={div} ===")
        i = 0
        for g in fix._iter_chord_groups(measure, ns):
            if staff and g[2] != staff:
                continue
            i += 1
            n = g[0]
            t = fix._note_type_text(n, ns) or "?"
            d = fix._note_duration(n, ns)
            beams = [b.text for b in n.findall(fix.qname(ns, "beam"))]
            stem = n.find(fix.qname(ns, "stem"))
            stem_v = stem.text if stem is not None else "-"
            if fix._is_rest(n, ns):
                p = "R-" + t
            else:
                p = "+".join(sorted(fix._pitch_label(x, ns) or "?" for x in g[1]))
            print(f"  #{i} v{g[3]} {t:8s} d={d} stem={stem_v} beam={beams or '-'} {p}")
