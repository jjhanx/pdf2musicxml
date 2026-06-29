#!/usr/bin/env python3
"""Trace rhythm repairs on specific measures."""
import copy
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

TARGETS = {"39", "42", "47", "56"}


def load_part(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        root = ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()
    ns = fix.mxl_ns_uri(root)
    return root.findall(".//" + fix.qname(ns, "part"))[4], ns


def max_staff(part, ns):
    return fix._max_staff_in_part(part, ns)


def run_trace(part, ns):
    ms = max_staff(part, ns)
    repairs = [
        ("quarter_pair", lambda m, d, e: fix._repair_leading_quarter_pair(m, ns, d, e)),
        ("quarter_pair_staff", lambda m, d, e: fix._repair_leading_quarter_pair_on_staff(m, ns, d, e)),
        ("quarter_after_beam", lambda m, d, e: fix._repair_quarter_pair_after_beam_run(m, ns, d, e)),
        ("two_quarter_voice", lambda m, d, e: fix._repair_two_quarter_voice_as_eighths(m, ns, d, e)),
        ("overfull_eighth", lambda m, d, e: 0),  # part-level
        ("general_overfull", lambda m, d, e: fix._general_resolve_overfull_measure(m, ns, ms, d, e)),
        ("three_eighth_triplet", lambda m, d, e: fix._repair_three_eighths_as_triplet(m, ns, ms, d, e)),
        ("four_eighth", lambda m, d, e: fix._repair_four_eighths_as_triplet_plus_eighth(m, ns, d)),
        ("collapsed_triplet", lambda m, d, e: fix._repair_two_collapsed_triplet_spans(m, ns, ms, d, e)),
        ("triplet_prefix", lambda m, d, e: fix._repair_two_quarters_as_triplet_prefix(m, ns, ms, d, e)),
        ("quarter_before_triplet", lambda m, d, e: fix._repair_quarter_chords_before_triplet_run(m, ns, ms, d, e)),
    ]
    for measure, div, exp in fix._iter_measures_with_timing(part, ns):
        mnum = measure.get("number")
        if mnum not in TARGETS:
            continue
        print(f"\n=== measure {mnum} div={div} exp={exp} ===")
        for name, fn in repairs:
            mcopy = copy.deepcopy(measure)
            n = fn(mcopy, div, exp)
            if n:
                print(f"  {name}: fixed={n}")


if __name__ == "__main__":
    part, ns = load_part("_smoke/omr-work-6855d546-full/audiveris_raw.mxl")
    run_trace(part, ns)
