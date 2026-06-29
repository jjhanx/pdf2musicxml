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
part = copy.deepcopy(root.findall(".//" + fix.qname(ns, "part"))[4])
parents = fix._parent_map(root)
ms = fix._max_staff_in_part(part, ns)

def show():
    for m in part.findall(fix.qname(ns, "measure")):
        if m.get("number") != "44":
            continue
        out = []
        for g in fix._iter_chord_groups(m, ns):
            if g[2] != "2":
                continue
            n = g[0]
            t = fix._note_type_text(n, ns)
            tm = n.find(fix.qname(ns, "time-modification")) is not None
            out.append(t + ("T" if tm else ""))
        return out

print("raw", show())
for measure in part.findall(fix.qname(ns, "measure")):
    fix._clean_measure(measure, ns, parents)
for measure, div, exp in fix._iter_measures_with_timing(part, ns):
    if measure.get("number") != "44":
        continue
    fix._flatten_underfull_voices_in_measure(measure, ns, exp)
    for name, fn in [
        ("swap", lambda: fix._repair_swap_leading_qq_with_beamed_pair(measure, ns, div, exp)),
        ("q2e", lambda: fix._repair_quarter_chord_to_beamed_eighth_pair_after_beam(measure, ns, div, exp)),
        ("qct", lambda: fix._repair_quarter_chords_before_triplet_run(measure, ns, ms, div, exp)),
        ("tri2", lambda: fix._repair_two_collapsed_triplet_spans(measure, ns, ms, div, exp)),
    ]:
        n = fn()
        if n:
            print(name, n, show())
