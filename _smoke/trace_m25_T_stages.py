#!/usr/bin/env python3
"""Progressive trace of fix_score_xml for T part m24."""
import copy
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

RAW = "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"


def types(part, num="24"):
    for m in part.findall(fix.qname(ns, "measure")):
        if m.get("number") == num:
            return [fix._note_type_text(g[0], ns) for g in fix._iter_chord_groups(m, ns)]
    return []


with zipfile.ZipFile(RAW) as z:
    c = z.read("META-INF/container.xml").decode()
    m = re.search(r'full-path="([^"]+)"', c)
    root = ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()
ns = fix.mxl_ns_uri(root)
parents = fix._build_parents(root)

part = root.findall(".//" + fix.qname(ns, "part"))[2]
print("0 raw", types(part))

# step 1 clean + consolidate
for measure in part.findall(fix.qname(ns, "measure")):
    if measure.get("number") != "24":
        continue
    fix._clean_measure(measure, ns, parents)
    fix._consolidate_cross_voices_on_staff(measure, ns)
print("1 after clean+consolidate", types(part))

# step 2 rhythm block
max_staff = fix._max_staff_in_part(part, ns)
for measure, divisions, expected in fix._iter_measures_with_timing(part, ns):
    if measure.get("number") != "24":
        continue
    fix._flatten_underfull_voices_in_measure(measure, ns, expected or 0)
    print("2 after flatten", types(part))
    if fix._measure_rhythm_repairable(measure, ns, expected or 0, divisions or 0):
        for name, fn in [
            ("swap", fix._repair_swap_leading_qq_with_beamed_pair),
            ("lead", fix._repair_leading_quarter_pair),
            ("lead_staff", fix._repair_leading_quarter_pair_on_staff),
            ("qeq", fix._repair_quarter_eighth_quarter_lost_final),
            ("pair_b", fix._repair_quarter_pair_before_eighths),
            ("pair_a", fix._repair_quarter_pair_after_beam_run),
            ("q2e", fix._repair_quarter_chord_to_beamed_eighth_pair_after_beam),
            ("trio", fix._repair_plain_beamed_trio_as_triplet_on_staff),
            ("orphan", fix._remove_isolated_quarter_voices_on_staff),
            ("qbr", fix._repair_quarter_chord_before_rest),
            ("twoq", fix._repair_two_quarter_voice_as_eighths),
            ("tri3", fix._repair_three_eighths_as_triplet),
            ("rest3", fix._repair_eighth_rest_plus_two_eighths_triplet),
            ("tri2", fix._repair_two_collapsed_triplet_spans),
            ("qct", fix._repair_quarter_chords_before_triplet_run),
            ("overfull", fix._general_resolve_overfull_measure),
        ]:
            if name == "trio":
                n = fn(measure, ns, max_staff, divisions or 0)
            elif name in ("tri3", "rest3", "tri2", "qct", "overfull"):
                n = fn(measure, ns, max_staff, divisions or 0, expected or 0)
            elif name == "q2e":
                n = fn(measure, ns, divisions or 0, expected or 0)
            else:
                n = fn(measure, ns, divisions or 0, expected or 0)
            if n:
                print(f"   {name}={n}", types(part))

fix._repair_dotted_quarter_misread(part, ns)
print("3 after dotted", types(part))
fix._repair_overfull_eighth(part, ns)
print("4 after overfull", types(part))

for measure in part.findall(fix.qname(ns, "measure")):
    if measure.get("number") != "24":
        continue
    fix._consolidate_cross_voices_on_staff(measure, ns)
    fix._consolidate_sequential_voice_after_backup(measure, ns)
    for staff in fix._staffs_in_measure(measure, ns):
        fix._reorder_staff_notes_by_default_x(measure, ns, staff)
print("5 after 2b", types(part))
