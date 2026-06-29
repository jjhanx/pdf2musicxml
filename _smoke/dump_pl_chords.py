#!/usr/bin/env python3
import io, re, sys, zipfile
import xml.etree.ElementTree as ET
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

RAW = "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"
with zipfile.ZipFile(RAW) as z:
    root = ET.fromstring(z.read(re.search(r'full-path="([^"]+)"', z.read("META-INF/container.xml").decode()).group(1)))
ns = fix.mxl_ns_uri(root)
part = root.findall(".//" + fix.qname(ns, "part"))[4]
for measure, div, exp in fix._iter_measures_with_timing(part, ns):
    if measure.get("number") != "44":
        continue
    for (st, v), groups in fix._voice_groups(measure, ns).items():
        if st != "2":
            continue
        print("n=", len(groups), "div", div)
        for i, g in enumerate(groups):
            print(i, len(g[1]), fix._note_type_text(g[0], ns),
                  fix._is_misread_quarter_chord_for_triplet(g, ns, div),
                  fix._note_duration(g[0], ns))
