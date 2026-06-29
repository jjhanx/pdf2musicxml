#!/usr/bin/env python3
import importlib.util, io, re, zipfile, xml.etree.ElementTree as ET
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
for measure, div, exp in fix._iter_measures_with_timing(part, ns):
    if measure.get("number") != "44":
        continue
    print(f"m44 repairable={fix._measure_rhythm_repairable(measure, ns, exp, div)}")
    for (staff, voice), groups in fix._voice_groups(measure, ns).items():
        if staff != "1":
            continue
        for i, g in enumerate(groups):
            beams = [b.text for n in g[1] for b in n.findall(fix.qname(ns, "beam"))]
            print(f" g{i}: {fix._chord_pitch_signature(g, ns)} type={fix._note_type_text(g[0],ns)} beams={beams}")
    m = measure
    n = fix._repair_swap_leading_qq_with_beamed_pair(m, ns, div, exp)
    print(f"swap fixed={n}")
    for (staff, voice), groups in fix._voice_groups(m, ns).items():
        if staff != "1":
            continue
        for i, g in enumerate(groups):
            print(f" after g{i}: {fix._chord_pitch_signature(g, ns)} type={fix._note_type_text(g[0],ns)}")
