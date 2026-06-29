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
ms = fix._max_staff_in_part(part, ns)

for measure, div, exp in fix._iter_measures_with_timing(part, ns):
    if measure.get("number") != "24":
        continue
    mc = copy.deepcopy(measure)
    steps = [
        ("flatten", lambda m: fix._flatten_underfull_voices_in_measure(m, ns, exp)),
        ("general_overfull", lambda m: fix._general_resolve_overfull_measure(m, ns, ms, div, exp)),
        ("swap_qq", lambda m: fix._repair_swap_leading_qq_with_beamed_pair(m, ns, div, exp)),
        ("leading_pair", lambda m: fix._repair_leading_quarter_pair(m, ns, div, exp)),
        ("leading_pair_staff", lambda m: fix._repair_leading_quarter_pair_on_staff(m, ns, div, exp)),
        ("q_e_q", lambda m: fix._repair_quarter_eighth_quarter_lost_final(m, ns, div, exp)),
        ("pair_before", lambda m: fix._repair_quarter_pair_before_eighths(m, ns, div, exp)),
        ("pair_after_beam", lambda m: fix._repair_quarter_pair_after_beam_run(m, ns, div, exp)),
        ("quarter_to_2e", lambda m: fix._repair_quarter_chord_to_beamed_eighth_pair_after_beam(m, ns, div)),
        ("two_q", lambda m: fix._repair_two_quarter_voice_as_eighths(m, ns, div, exp)),
        ("plain_trio", lambda m: fix._repair_plain_beamed_trio_as_triplet_on_staff(m, ns, ms, div)),
        ("orphan_q", lambda m: fix._remove_isolated_quarter_voices_on_staff(m, ns, div, exp)),
    ]
    for name, fn in steps:
        n = fn(mc)
        if n:
            print(f"{name}: {n}")
            grps = list(fix._voice_groups(mc, ns).values())[0]
            types = [fix._note_type_text(g[0], ns) for g in grps]
            print("  ->", types)
