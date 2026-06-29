#!/usr/bin/env python3
"""Trace repairs on specific measures."""
import copy, io, re, sys, zipfile
import xml.etree.ElementTree as ET
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

RAW = "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"
with zipfile.ZipFile(RAW) as z:
    root_bytes = z.read(re.search(r'full-path="([^"]+)"', z.read("META-INF/container.xml").decode()).group(1))

TARGETS = {
    (1, "18"): "A m19",
    (4, "44"): "B m45",
    (4, "44", "2"): "PL m45",
    (4, "44", "1"): "PR m45",
}

def show(part, mnum, staff=None):
    ns = fix.mxl_ns_uri(part)
    for measure, _, _ in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != mnum:
            continue
        out = []
        for g in fix._iter_chord_groups(measure, ns):
            if staff and g[2] != staff:
                continue
            n = g[0]
            t = fix._note_type_text(n, ns)
            if fix._is_rest(n, ns):
                t = "R-" + t
            p = n.find(fix.qname(ns, "pitch"))
            ps = ""
            if p is not None:
                ps = p.find(fix.qname(ns, "step")).text + p.find(fix.qname(ns, "octave")).text
            out.append(f"{t}{ps}")
        return out

root = ET.fromstring(root_bytes)
ns = fix.mxl_ns_uri(root)
parents = fix._parent_map(root)

for key, label in TARGETS.items():
    pi, mnum = key[0], key[1]
    staff = key[2] if len(key) > 2 else None
    part = copy.deepcopy(root.findall(".//" + fix.qname(ns, "part"))[pi])
    print(f"\n===== {label} =====")
    print("raw", show(part, mnum, staff))
    for measure in part.findall(fix.qname(ns, "measure")):
        fix._clean_measure(measure, ns, parents)
    ms = fix._max_staff_in_part(part, ns)
    for measure, div, exp in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != mnum:
            continue
        fix._flatten_underfull_voices_in_measure(measure, ns, exp or 0)
        print("flatten", show(part, mnum, staff))
        if not fix._measure_rhythm_repairable(measure, ns, exp or 0, div or 0):
            continue
        steps = [
            ("swap", lambda m: fix._repair_swap_leading_qq_with_beamed_pair(m, ns, div, exp)),
            ("pickup", lambda m: fix._repair_leading_pickup_eighth_misread(m, ns, div, exp)),
            ("lead", lambda m: fix._repair_leading_quarter_pair(m, ns, div, exp)),
            ("lead_st", lambda m: fix._repair_leading_quarter_pair_on_staff(m, ns, div, exp)),
            ("qeq", lambda m: fix._repair_quarter_eighth_quarter_lost_final(m, ns, div, exp)),
            ("pair_b", lambda m: fix._repair_quarter_pair_before_eighths(m, ns, div, exp)),
            ("pair_a", lambda m: fix._repair_quarter_pair_after_beam_run(m, ns, div, exp)),
            ("q2e", lambda m: fix._repair_quarter_chord_to_beamed_eighth_pair_after_beam(m, ns, div, exp)),
            ("twoq", lambda m: fix._repair_two_quarter_voice_as_eighths(m, ns, div, exp)),
            ("overfull_g", lambda m: fix._general_resolve_overfull_measure(m, ns, ms, div, exp)),
        ]
        for name, fn in steps:
            n = fn(measure)
            if n:
                print(f"  {name}={n}", show(part, mnum, staff))
    fix._repair_dotted_quarter_misread(part, ns)
    print("dotted", show(part, mnum, staff))
    fix._repair_overfull_eighth(part, ns)
    print("overfull", show(part, mnum, staff))
