#!/usr/bin/env python3
import copy, importlib.util, io, re, zipfile, xml.etree.ElementTree as ET
from pathlib import Path
spec = importlib.util.spec_from_file_location("fix", Path("scripts/fix_audiveris_mxl.py"))
fix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fix)

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
    before = fix._voice_groups(m, ns)[("2", "5")]
    print(f"before groups={len(before)}")
    print("direct repair:", fix._repair_two_collapsed_triplet_spans(m, ns, max_staff, div, exp))
    for (staff, voice), groups in fix._voice_groups(m, ns).items():
        if staff != "2":
            continue
        total = sum(fix._note_duration(g[0], ns) or 0 for g in groups)
        print(f"groups={len(groups)} total={total}/{exp}")
        for i, g in enumerate(groups):
            print(f"  {i}: {fix._chord_pitch_signature(g, ns)} stem={fix._stem_from_note(g[0],ns)}")
