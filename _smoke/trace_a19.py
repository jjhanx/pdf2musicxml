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
part = copy.deepcopy(root.findall(".//" + fix.qname(ns, "part"))[2])  # A = P3

def dump(measure):
    for g in fix._iter_chord_groups(measure, ns):
        n = g[0]
        t = fix._note_type_text(n, ns)
        if fix._is_rest(n, ns):
            t = "R-" + t
        p = n.find(fix.qname(ns, "pitch"))
        ps = p.find(fix.qname(ns, "step")).text + p.find(fix.qname(ns, "octave")).text if p is not None else ""
        print(f"  {t} d={fix._note_duration(n,ns)} {ps} x={n.get('default-x')}")

for measure, div, exp in fix._iter_measures_with_timing(part, ns):
    if measure.get("number") != "18":
        continue
    print("RAW exp", exp, "div", div)
    dump(measure)
    fix._flatten_underfull_voices_in_measure(measure, ns, exp)
    fix._repair_leading_pickup_eighth_misread(measure, ns, div, exp)
    print("after pickup")
    dump(measure)
    fix._repair_quarter_pair_before_eighths(measure, ns, div, exp)
    print("after pair_before")
    dump(measure)
    fix._repair_dotted_quarter_misread(part, ns)
    for m2 in part.findall(fix.qname(ns, "measure")):
        if m2.get("number") == "18":
            print("after dotted")
            dump(m2)
    fix._repair_overfull_eighth(part, ns)
    for m2 in part.findall(fix.qname(ns, "measure")):
        if m2.get("number") == "18":
            print("after overfull")
            dump(m2)
