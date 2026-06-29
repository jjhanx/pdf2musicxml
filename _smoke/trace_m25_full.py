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


def t24(root, part_idx=2):
    ns = fix.mxl_ns_uri(root)
    part = root.findall(".//" + fix.qname(ns, "part"))[part_idx]
    for m in part.findall(fix.qname(ns, "measure")):
        if m.get("number") == "24":
            return [fix._note_type_text(g[0], ns) for g in fix._iter_chord_groups(m, ns)]
    return []


with zipfile.ZipFile(RAW) as z:
    c = z.read("META-INF/container.xml").decode()
    m = re.search(r'full-path="([^"]+)"', c)
    root = ET.fromstring(z.read(m.group(1)))
ns = fix.mxl_ns_uri(root)
parents = fix._parent_map(root)

print("raw T", t24(root, 2))

# replicate fix_score_xml
for part in root.findall(fix.qname(ns, "part")):
    for measure in part.findall(fix.qname(ns, "measure")):
        fix._clean_measure(measure, ns, parents)
        fix._consolidate_cross_voices_on_staff(measure, ns)
print("after step1 T", t24(root, 2))

for part in root.findall(fix.qname(ns, "part")):
    max_staff = fix._max_staff_in_part(part, ns)
    for measure, divisions, expected in fix._iter_measures_with_timing(part, ns):
        fix._flatten_underfull_voices_in_measure(measure, ns, expected or 0)
        if not fix._measure_rhythm_repairable(measure, ns, expected or 0, divisions or 0):
            continue
        fix._repair_swap_leading_qq_with_beamed_pair(measure, ns, divisions or 0, expected or 0)
        fix._repair_leading_quarter_pair(measure, ns, divisions or 0, expected or 0)
        fix._repair_leading_quarter_pair_on_staff(measure, ns, divisions or 0, expected or 0)
        fix._repair_quarter_eighth_quarter_lost_final(measure, ns, divisions or 0, expected or 0)
        fix._repair_quarter_pair_before_eighths(measure, ns, divisions or 0, expected or 0)
        fix._repair_quarter_pair_after_beam_run(measure, ns, divisions or 0, expected or 0)
        n = fix._repair_quarter_chord_to_beamed_eighth_pair_after_beam(
            measure, ns, divisions or 0, expected or 0
        )
        if measure.get("number") == "24" and part == root.findall(fix.qname(ns, "part"))[2] and n:
            print("q2e fired on T m24", n, t24(root, 2))
        fix._repair_plain_beamed_trio_as_triplet_on_staff(measure, ns, max_staff, divisions or 0)
        fix._remove_isolated_quarter_voices_on_staff(measure, ns, divisions or 0, expected or 0)
        fix._repair_quarter_chord_before_rest(measure, ns, divisions or 0, expected or 0)
        fix._repair_two_quarter_voice_as_eighths(measure, ns, divisions or 0, expected or 0)
        fix._general_resolve_overfull_measure(measure, ns, max_staff, divisions or 0, expected or 0)
    if part == root.findall(fix.qname(ns, "part"))[2]:
        print("after rhythm T m24", t24(root, 2))
    fix._repair_dotted_quarter_misread(part, ns)
    if part == root.findall(fix.qname(ns, "part"))[2]:
        print("after dotted T m24", t24(root, 2))
    fix._repair_overfull_eighth(part, ns)
    if part == root.findall(fix.qname(ns, "part"))[2]:
        print("after overfull T m24", t24(root, 2))

for part in root.findall(fix.qname(ns, "part")):
    for measure in part.findall(fix.qname(ns, "measure")):
        fix._consolidate_cross_voices_on_staff(measure, ns)
        fix._consolidate_sequential_voice_after_backup(measure, ns)
        for staff in fix._staffs_in_measure(measure, ns):
            fix._reorder_staff_notes_by_default_x(measure, ns, staff)
print("after 2b T", t24(root, 2))
