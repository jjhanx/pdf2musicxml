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

for pi, label in [(1, "S"), (3, "T")]:
    part = copy.deepcopy(root.findall(".//" + fix.qname(ns, "part"))[pi])
    def show(tag):
        for m in part.findall(fix.qname(ns, "measure")):
            if m.get("number") != "18":
                continue
            print(f"{label} {tag}:", end=" ")
            for g in fix._iter_chord_groups(m, ns):
                n = g[0]
                t = fix._note_type_text(n, ns)
                if fix._is_rest(n, ns):
                    t = "R-" + t
                p = n.find(fix.qname(ns, "pitch"))
                ps = p.find(fix.qname(ns, "step")).text if p is not None else "-"
                print(f"{t}{ps}@{n.get('default-x')}", end=" ")
            print()
    show("raw")
    for measure in part.findall(fix.qname(ns, "measure")):
        fix._clean_measure(measure, ns, parents)
    for measure, div, exp in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != "18":
            continue
        fix._flatten_underfull_voices_in_measure(measure, ns, exp)
    fix._repair_dotted_quarter_misread(part, ns)
    show("dotted")
    fix._repair_overfull_eighth(part, ns)
    show("overfull")
