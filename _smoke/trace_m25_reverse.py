#!/usr/bin/env python3
"""Which repair converts eighths to quarters or leaves rest instead of eighth?"""
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
    root = ET.fromstring(z.read(m.group(1)))
ns = fix.mxl_ns_uri(root)
parents = fix._parent_map(root)


def types(part, num="24", staff_filter=None):
    for measure, _, _ in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != num:
            continue
        out = []
        for g in fix._iter_chord_groups(measure, ns):
            if staff_filter and g[2] != staff_filter:
                continue
            n = g[0]
            t = fix._note_type_text(n, ns)
            if fix._is_rest(n, ns):
                t = "rest-" + t
            out.append(t)
        return out


def trace_part(part_idx, label, staff=None):
    part = root.findall(".//" + fix.qname(ns, "part"))[part_idx]
    print(f"\n===== {label} =====")
    print("raw", types(part, staff_filter=staff))

    # full pipeline stages on copy
    p = copy.deepcopy(part)
    for measure in p.findall(fix.qname(ns, "measure")):
        fix._clean_measure(measure, ns, parents)
        fix._consolidate_cross_voices_on_staff(measure, ns)

    ms = fix._max_staff_in_part(p, ns)
    for measure, div, exp in fix._iter_measures_with_timing(p, ns):
        if measure.get("number") != "24":
            continue
        fix._flatten_underfull_voices_in_measure(measure, ns, exp or 0)
    print("after flatten", types(p, staff_filter=staff))

    for measure, div, exp in fix._iter_measures_with_timing(p, ns):
        if measure.get("number") != "24":
            continue
        if not fix._measure_rhythm_repairable(measure, ns, exp or 0, div or 0):
            continue
        steps = [
            ("swap", lambda m: fix._repair_swap_leading_qq_with_beamed_pair(m, ns, div, exp)),
            ("lead", lambda m: fix._repair_leading_quarter_pair(m, ns, div, exp)),
            ("lead_staff", lambda m: fix._repair_leading_quarter_pair_on_staff(m, ns, div, exp)),
            ("qeq", lambda m: fix._repair_quarter_eighth_quarter_lost_final(m, ns, div, exp)),
            ("pair_b", lambda m: fix._repair_quarter_pair_before_eighths(m, ns, div, exp)),
            ("pair_a", lambda m: fix._repair_quarter_pair_after_beam_run(m, ns, div, exp)),
            ("q2e", lambda m: fix._repair_quarter_chord_to_beamed_eighth_pair_after_beam(m, ns, div, exp)),
            ("twoq", lambda m: fix._repair_two_quarter_voice_as_eighths(m, ns, div, exp)),
        ]
        for name, fn in steps:
            n = fn(measure)
            if n:
                print(f"  {name}={n}", types(p, staff_filter=staff))

    fix._repair_dotted_quarter_misread(p, ns)
    print("after dotted", types(p, staff_filter=staff))
    fix._repair_overfull_eighth(p, ns)
    print("after overfull", types(p, staff_filter=staff))


trace_part(2, "T")
trace_part(3, "B")
trace_part(4, "PR", staff="1")
