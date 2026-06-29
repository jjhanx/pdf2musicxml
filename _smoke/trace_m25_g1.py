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

repairs = [
    ("swap_qq", lambda m, d, e: fix._repair_swap_leading_qq_with_beamed_pair(m, ns, d, e)),
    ("leading_pair", lambda m, d, e: fix._repair_leading_quarter_pair(m, ns, d, e)),
    ("leading_pair_staff", lambda m, d, e: fix._repair_leading_quarter_pair_on_staff(m, ns, d, e)),
    ("q_e_q_lost", lambda m, d, e: fix._repair_quarter_eighth_quarter_lost_final(m, ns, d, e)),
    ("pair_before_8", lambda m, d, e: fix._repair_quarter_pair_before_eighths(m, ns, d, e)),
    ("pair_after_beam", lambda m, d, e: fix._repair_quarter_pair_after_beam_run(m, ns, d, e)),
    ("quarter_to_2eighth", lambda m, d, e: fix._repair_quarter_chord_to_beamed_eighth_pair_after_beam(m, ns, d, e)),
    ("plain_trio", lambda m, d, e: fix._repair_plain_beamed_trio_as_triplet_on_staff(m, ns, 1, d)),
    ("orphan_q", lambda m, d, e: fix._remove_isolated_quarter_voices_on_staff(m, ns, d, e)),
    ("q_before_rest", lambda m, d, e: fix._repair_quarter_chord_before_rest(m, ns, d, e)),
    ("two_q_voice", lambda m, d, e: fix._repair_two_quarter_voice_as_eighths(m, ns, d, e)),
    ("overfull", lambda m, d, e: fix._general_resolve_overfull_measure(m, ns, 1, d, e)),
]


def types(measure):
    return [fix._note_type_text(g[0], ns) for g in fix._iter_chord_groups(measure, ns)]


for part_idx, label in [(2, "T"), (3, "B"), (4, "PR")]:
    part = root.findall(".//" + fix.qname(ns, "part"))[part_idx]
    ms = fix._max_staff_in_part(part, ns)
    for measure, div, exp in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != "24":
            continue
        print(f"\n=== {label} raw ===", types(measure))
        mc = copy.deepcopy(measure)
        fix._flatten_underfull_voices_in_measure(mc, ns, exp)
        print("after flatten", types(mc))
        state = copy.deepcopy(mc)
        for name, fn in repairs:
            n = fn(state, div, exp)
            if n:
                print(f"  {name}: {n} -> {types(state)}")
        part2 = copy.deepcopy(part)
        fix._repair_dotted_quarter_misread(part2, ns)
        for m2 in part2.findall(fix.qname(ns, "measure")):
            if m2.get("number") == "24":
                print("after dotted_quarter", types(m2))
