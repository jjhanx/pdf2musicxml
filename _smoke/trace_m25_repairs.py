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
    ("swap_qq", fix._repair_swap_leading_qq_with_beamed_pair),
    ("leading_pair", fix._repair_leading_quarter_pair),
    ("leading_pair_staff", fix._repair_leading_quarter_pair_on_staff),
    ("q_e_q_lost", fix._repair_quarter_eighth_quarter_lost_final),
    ("pair_before_8", fix._repair_quarter_pair_before_eighths),
    ("pair_after_beam", fix._repair_quarter_pair_after_beam_run),
    ("quarter_to_2eighth", fix._repair_quarter_chord_to_beamed_eighth_pair_after_beam),
    ("two_q_voice", fix._repair_two_quarter_voice_as_eighths),
]

for part_idx, label in [(2, "T"), (3, "B"), (4, "PR")]:
    part = root.findall(".//" + fix.qname(ns, "part"))[part_idx]
    ms = fix._max_staff_in_part(part, ns)
    for measure, div, exp in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != "24":
            continue
        print(f"\n=== {label} div={div} exp={exp} ===")
        for name, fn in repairs:
            mc = copy.deepcopy(measure)
            n = fn(mc, ns, div, exp) if name != "quarter_to_2eighth" else fn(mc, ns, div)
            if n:
                print(f"  {name}: {n}")
