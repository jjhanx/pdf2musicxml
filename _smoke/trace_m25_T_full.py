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

def show(m, label):
    for measure in part.findall(fix.qname(ns, "measure")):
        if measure.get("number") != "24":
            continue
        types = []
        for g in fix._iter_chord_groups(measure, ns):
            types.append(fix._note_type_text(g[0], ns))
        print(label, types)

for measure in part.findall(fix.qname(ns, "measure")):
    if measure.get("number") != "24":
        continue
    mc = copy.deepcopy(measure)
    show(part, "raw")
    div, exp = 12, 48
    ms = 1
    fix._flatten_underfull_voices_in_measure(mc, ns, exp)
    show_mc = mc
    # rhythm block
    for name, fn in [
        ("q2e", lambda m: fix._repair_quarter_chord_to_beamed_eighth_pair_after_beam(m, ns, div)),
        ("pair_before", lambda m: fix._repair_quarter_pair_before_eighths(m, ns, div, exp)),
    ]:
        n = fn(mc)
        if n:
            types = [fix._note_type_text(g[0], ns) for g in fix._iter_chord_groups(mc, ns)]
            print(name, n, types)

# dotted on part
part2 = copy.deepcopy(part)
fix._repair_dotted_quarter_misread(part2, ns)
for measure in part2.findall(fix.qname(ns, "measure")):
    if measure.get("number") == "24":
        types = [fix._note_type_text(g[0], ns) for g in fix._iter_chord_groups(measure, ns)]
        print("after dotted", types)
