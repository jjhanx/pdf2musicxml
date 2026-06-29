#!/usr/bin/env python3
import importlib.util, io, re, zipfile, xml.etree.ElementTree as ET
from pathlib import Path

spec = importlib.util.spec_from_file_location("fix", Path("scripts/fix_audiveris_mxl.py"))
fix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fix)

mxl = "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"
z = zipfile.ZipFile(mxl)
c = z.read("META-INF/container.xml").decode()
rf = re.search(r'full-path="([^"]+)"', c).group(1)
root = ET.parse(io.BytesIO(z.read(rf))).getroot()
ns = re.match(r"\{(.*)\}", root.tag).group(1) if re.match(r"\{(.*)\}", root.tag) else ""
part = [p for p in root.findall(fix.qname(ns, "part")) if p.get("id") == "P5"][0]
max_staff = fix._max_staff_in_part(part, ns)
for measure, div, exp in fix._iter_measures_with_timing(part, ns):
    if measure.get("number") != "44":
        continue
    m = measure
    print(f"before div={div} exp={exp}")
    for (staff, voice), groups in fix._voice_groups(m, ns).items():
        if staff != "2":
            continue
        total = sum(fix._note_duration(g[0], ns) or 0 for g in groups)
        print(f" voice {voice} total={total}")
    n = fix._repair_two_quarters_as_triplet_prefix(m, ns, max_staff, exp)
    print(f"prefix fixed={n} (old rules)")
    for (staff, voice), groups in fix._voice_groups(m, ns).items():
        if staff != "2":
            continue
        total = sum(fix._note_duration(g[0], ns) or 0 for g in groups)
        print(f" after total={total} groups={len(groups)}")
        for i, g in enumerate(groups[:8]):
            print(f"  g{i}: {fix._chord_pitch_signature(g, ns)}")
