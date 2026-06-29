#!/usr/bin/env python3
import copy
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
    root = ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()
ns = fix.mxl_ns_uri(root)
part = root.findall(".//" + fix.qname(ns, "part"))[2]
for measure, div, exp in fix._iter_measures_with_timing(part, ns):
    if measure.get("number") != "24":
        continue
    mc = copy.deepcopy(measure)
    n = fix._repair_quarter_chord_to_beamed_eighth_pair_after_beam(mc, ns, div)
    print("after quarter_to_2eighth:", n)
    for k, grps in fix._voice_groups(mc, ns).items():
        print("voice", k)
        for i, g in enumerate(grps):
            print(
                i,
                fix._note_type_text(g[0], ns),
                fix._note_duration(g[0], ns),
                [b.text for b in g[0].findall(fix.qname(ns, "beam"))],
            )
