#!/usr/bin/env python3
import copy, io, re, sys, zipfile
import xml.etree.ElementTree as ET
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

RAW = "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"
with zipfile.ZipFile(RAW) as z:
    rb = z.read(re.search(r'full-path="([^"]+)"', z.read("META-INF/container.xml").decode()).group(1))
root = ET.fromstring(rb)
ns = fix.mxl_ns_uri(root)
parents = fix._parent_map(root)
part = copy.deepcopy(root.findall(".//" + fix.qname(ns, "part"))[4])

def v1show():
    for m in part.findall(fix.qname(ns, "measure")):
        if m.get("number") != "18":
            continue
        for g in fix._iter_chord_groups(m, ns):
            if g[3] != "1":
                continue
            n = g[0]
            t = fix._note_type_text(n, ns)
            if fix._is_rest(n, ns):
                t = "R-" + t
            print(t, fix._note_duration(n, ns))

print("raw"); v1show()
for measure, div, exp in fix._iter_measures_with_timing(part, ns):
    if measure.get("number") != "18":
        continue
    fix._flatten_underfull_voices_in_measure(measure, ns, exp)
    for name, fn in [
        ("pickup", lambda: fix._repair_leading_pickup_eighth_misread(measure, ns, div, exp)),
        ("pair_b", lambda: fix._repair_quarter_pair_before_eighths(measure, ns, div, exp)),
        ("lead", lambda: fix._repair_leading_quarter_pair(measure, ns, div, exp)),
    ]:
        n = fn()
        if n:
            print(name, n)
            v1show()
fix._repair_dotted_quarter_misread(part, ns)
print("dotted"); v1show()
fix._repair_overfull_eighth(part, ns)
print("overfull"); v1show()
