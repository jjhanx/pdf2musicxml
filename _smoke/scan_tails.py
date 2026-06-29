#!/usr/bin/env python3
import io, re, sys, zipfile, copy
import xml.etree.ElementTree as ET
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

RAW = "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"
with zipfile.ZipFile(RAW) as z:
    root = ET.fromstring(z.read(re.search(r'full-path="([^"]+)"', z.read("META-INF/container.xml").decode()).group(1)))
ns = fix.mxl_ns_uri(root)

# find m18 m19 m24 m41 m44 across all parts
for mnum in ["18", "24", "41", "44"]:
    print(f"\n==== MXL {mnum} ====")
    for pi, p in enumerate(root.findall(".//" + fix.qname(ns, "part"))):
        part = p
        for measure, exp, div in [(m, e, d) for m, d, e in fix._iter_measures_with_timing(part, ns) if m.get("number") == mnum]:
            groups = list(fix._iter_chord_groups(measure, ns))
            if not groups:
                continue
            tail = groups[-3:]
            has_tail_rest = any(fix._is_rest(g[0], ns) for g in groups[-2:])
            print(f" P{pi+1} n={len(groups)} exp={exp} tail_rest={has_tail_rest}", end="")
            for g in tail:
                n = g[0]
                t = fix._note_type_text(n, ns)
                if fix._is_rest(n, ns):
                    t = "R-" + t
                print(f" |{t}|", end="")
            print()
