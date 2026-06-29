#!/usr/bin/env python3
import io, re, sys, zipfile
import xml.etree.ElementTree as ET
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

paths = {
    "RAW": "_smoke/omr-work-10373611/audiveris_raw.mxl",
    "REV": "_smoke/omr-work-10373611/review.mxl",
    "OFF": "_smoke/10373611_off.mxl",
}

CASES = [
    (8, "S", 1, None), (11, "S", 1, None), (26, "S", 1, None),
    (25, "PR", 4, "1"), (45, "PR", 4, "1"), (61, "PR", 4, "1"),
    (57, "S", 1, None), (59, "S", 1, None),
]

def load(p):
    with zipfile.ZipFile(p) as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        return ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()

for tag, path in paths.items():
    root = load(path)
    ns = fix.mxl_ns_uri(root)
    print(f"\n######## {tag} ########")
    for pm, label, pidx, staff in CASES:
        mxl = pm - 1
        part = root.findall(".//" + fix.qname(ns, "part"))[pidx]
        for measure, div, exp in fix._iter_measures_with_timing(part, ns):
            if measure.get("number") != str(mxl):
                continue
            print(f"\n--- printed m{pm} {label} ---")
            i = 0
            for g in fix._iter_chord_groups(measure, ns):
                if staff and g[2] != staff:
                    continue
                i += 1
                n = g[0]
                t = fix._note_type_text(n, ns) or "?"
                d = fix._note_duration(n, ns)
                beams = [b.text for b in n.findall(fix.qname(ns, "beam"))]
                if fix._is_rest(n, ns):
                    p = "R-" + t
                else:
                    p = "+".join(sorted(fix._pitch_label(x, ns) or "?" for x in g[1]))
                print(f"  #{i} {t:8s} d={d} beam={beams or '-'} {p}")
