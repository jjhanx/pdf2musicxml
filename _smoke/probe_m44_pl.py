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
    print(f"m44 div={div} exp={exp} triplet_span={fix._triplet_span_duration(div)}")
    for (staff, voice), groups in fix._voice_groups(measure, ns).items():
        if staff != "2":
            continue
        total = sum(fix._note_duration(g[0], ns) or 0 for g in groups)
        print(f" staff2 voice={voice} total={total} groups={len(groups)}")
        for i, g in enumerate(groups):
            sig = fix._chord_pitch_signature(g, ns)
            dur = fix._note_duration(g[0], ns)
            typ = fix._note_type_text(g[0], ns)
            tm = g[0].find(fix.qname(ns, "time-modification")) is not None
            mis = fix._is_misread_quarter_chord_for_triplet(g, ns, div)
            print(f"  g{i}: {sig} type={typ} dur={dur} tm={tm} misread_q={mis}")
