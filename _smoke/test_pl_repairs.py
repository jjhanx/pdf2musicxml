#!/usr/bin/env python3
import copy, importlib.util, io, re, zipfile, xml.etree.ElementTree as ET
from pathlib import Path

spec = importlib.util.spec_from_file_location("fix", Path("scripts/fix_audiveris_mxl.py"))
fix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fix)

mxl = "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"
z = zipfile.ZipFile(mxl)
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
    n1 = fix._repair_two_quarters_as_triplet_prefix(m, ns, max_staff, exp, div)
    print(f"prefix={n1}")
    for (staff, voice), groups in fix._voice_groups(m, ns).items():
        if staff != "2":
            continue
        total = sum(fix._note_duration(g[0], ns) or 0 for g in groups)
        print(f"after prefix: groups={len(groups)} pitched_total={total} exp={exp}")
        for i, g in enumerate(groups):
            print(f"  {i}: {fix._chord_pitch_signature(g, ns)} tm={g[0].find(fix.qname(ns,'time-modification')) is not None} dur={fix._note_duration(g[0],ns)}")

    m2 = copy.deepcopy(measure)
    n2 = fix._repair_quarter_chords_before_triplet_run(m2, ns, max_staff, div, exp)
    print(f"\nexpand={n2}")
    for (staff, voice), groups in fix._voice_groups(m2, ns).items():
        if staff != "2":
            continue
        total = sum(fix._note_duration(g[0], ns) or 0 for g in groups)
        print(f"after expand: groups={len(groups)} pitched_total={total}")

    # combined: prefix then expand remaining Q?
    m3 = copy.deepcopy(measure)
    fix._repair_two_quarters_as_triplet_prefix(m3, ns, max_staff, exp, div)
    fix._repair_quarter_chords_before_triplet_run(m3, ns, max_staff, div, exp)
    print("\ncombined:")
    for (staff, voice), groups in fix._voice_groups(m3, ns).items():
        if staff != "2":
            continue
        total = sum(fix._note_duration(g[0], ns) or 0 for g in groups)
        print(f" groups={len(groups)} pitched_total={total}")
        for i, g in enumerate(groups):
            print(f"  {i}: {fix._chord_pitch_signature(g, ns)}")
