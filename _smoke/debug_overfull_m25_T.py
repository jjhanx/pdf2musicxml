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
parents = fix._parent_map(root)
for measure in part.findall(fix.qname(ns, "measure")):
    fix._clean_measure(measure, ns, parents)
    fix._consolidate_cross_voices_on_staff(measure, ns)
max_staff = fix._max_staff_in_part(part, ns)
for measure, div, exp in fix._iter_measures_with_timing(part, ns):
    fix._flatten_underfull_voices_in_measure(measure, ns, exp or 0)
    if fix._measure_rhythm_repairable(measure, ns, exp or 0, div or 0):
        fix._repair_swap_leading_qq_with_beamed_pair(measure, ns, div, exp)
        fix._repair_leading_quarter_pair(measure, ns, div, exp)
        fix._repair_leading_quarter_pair_on_staff(measure, ns, div, exp)
        fix._repair_quarter_eighth_quarter_lost_final(measure, ns, div, exp)
        fix._repair_quarter_pair_before_eighths(measure, ns, div, exp)
        fix._repair_quarter_pair_after_beam_run(measure, ns, div, exp)
        fix._repair_quarter_chord_to_beamed_eighth_pair_after_beam(measure, ns, div, exp)
        fix._repair_plain_beamed_trio_as_triplet_on_staff(measure, ns, max_staff, div)
        fix._remove_isolated_quarter_voices_on_staff(measure, ns, div, exp)
        fix._repair_quarter_chord_before_rest(measure, ns, div, exp)
        fix._repair_two_quarter_voice_as_eighths(measure, ns, div, exp)
        fix._general_resolve_overfull_measure(measure, ns, max_staff, div, exp)
fix._repair_dotted_quarter_misread(part, ns)

for measure, div, exp in fix._iter_measures_with_timing(part, ns):
    if measure.get("number") != "24":
        continue
    eighth = div // 2
    print("exp", exp, "div", div, "target overfull", exp + eighth)
    for (st, v), groups in fix._voice_groups(measure, ns).items():
        total = sum(fix._note_duration(g[0], ns) or 0 for g in groups)
        print(f"voice {v} staff {st} total={total}")
        for i, g in enumerate(groups):
            n = g[0]
            print(
                " ",
                i,
                fix._note_type_text(n, ns),
                fix._note_duration(n, ns),
                n.get("default-x"),
            )
    # simulate overfull pick
    for (_, _voice), groups in fix._voice_groups(measure, ns).items():
        total = sum(fix._note_duration(g[0], ns) or 0 for g in groups)
        if total != exp + eighth:
            print(f"voice {_voice} skip total={total}")
            continue
        print(f"OVERFULL CANDIDATE voice {_voice}")
        for i, (leader, _, _, _) in enumerate(groups):
            if fix._note_type_text(leader, ns) == "quarter":
                print("  quarter candidate", i, leader.get("default-x"))
