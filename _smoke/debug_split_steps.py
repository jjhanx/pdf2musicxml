#!/usr/bin/env python3
import copy, importlib.util, io, re, zipfile, xml.etree.ElementTree as ET
from pathlib import Path
spec = importlib.util.spec_from_file_location("fix", Path("scripts/fix_audiveris_mxl.py"))
fix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fix)

def dump(m, ns, label):
    for (staff, voice), groups in fix._voice_groups(m, ns).items():
        if staff != "2":
            continue
        print(label, len(groups))
        for i,g in enumerate(groups):
            print(f"  {i}: {fix._chord_pitch_signature(g, ns)}")

path = Path("_smoke/omr-work-6855d546-full/audiveris_raw.mxl")
z = zipfile.ZipFile(path)
c = z.read("META-INF/container.xml").decode()
rf = re.search(r'full-path="([^"]+)"', c).group(1)
root = ET.parse(io.BytesIO(z.read(rf))).getroot()
ns = fix.mxl_ns_uri(root)
part = [p for p in root.findall(fix.qname(ns, "part")) if p.get("id") == "P5"][0]
max_staff = fix._max_staff_in_part(part, ns)
for measure, div, exp in fix._iter_measures_with_timing(part, ns):
    if measure.get("number") != "44":
        continue
    m = copy.deepcopy(measure)
    groups = fix._voice_groups(m, ns)[("2", "5")]
    g0, g1, g2 = groups[0], groups[1], groups[2]
    slice3_template = g2
    collapsed_q2 = g1
    triplet_dur = fix._triplet_eighth_duration(div)
    stem_ref = g2[0]
    staff, voice = "2", "5"
    fix._detach_chord_tail_as_new_group(m, g0, ns)
    dump(m, ns, "after detach")
    groups = fix._voice_groups(m, ns)[("2", "5")]
    split_group, g0_tail = groups[0], groups[1]
    for j, (grp, beam) in enumerate(((split_group, "begin"), (g0_tail, "continue"))):
        for n in grp[1]:
            fix._ensure_time_modification(n, ns)
            fix._set_note_type_duration(n, ns, triplet_dur, "eighth")
            fix._set_beam(n, ns, beam)
    dump(m, ns, "after convert B1 B2")
    for j, template in enumerate(slice3_template[1]):
        clone = fix._clone_triplet_slice_note(template, ns, triplet_dur, "end", j>0, staff, max_staff, stem_ref)
        insert_at = list(m).index(g0_tail[1][-1]) + 1
        m.insert(insert_at, clone)
    dump(m, ns, "after slice3")
    groups = fix._voice_groups(m, ns)[("2", "5")]
    g1 = next((g for g in groups if g is collapsed_q2 or fix._is_misread_quarter_chord_for_triplet(g, ns, div)), None)
    print("expand target", fix._chord_pitch_signature(g1, ns))
    fix._expand_quarter_chord_group_to_triplet(m, g1, ns, triplet_dur, max_staff, stem_ref=stem_ref)
    dump(m, ns, "after expand q2")
