#!/usr/bin/env python3
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

RAW = "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"

with zipfile.ZipFile(RAW) as z:
    c = z.read("META-INF/container.xml").decode()
    m = re.search(r'full-path="([^"]+)"', c)
    root = ET.fromstring(z.read(m.group(1)))
ns = fix.mxl_ns_uri(root)
part = root.findall(".//" + fix.qname(ns, "part"))[2]

for label, measure in [("raw", None)]:
    for measure, div, exp in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != "24":
            continue
        for (st, v), groups in fix._voice_groups(measure, ns).items():
            total = sum(fix._note_duration(g[0], ns) or 0 for g in groups)
            print("RAW voice", v, "total", total)
            for i, g in enumerate(groups):
                n = g[0]
                print(" ", i, fix._note_type_text(n, ns), fix._note_duration(n, ns))
