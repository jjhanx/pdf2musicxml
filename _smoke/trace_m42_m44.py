#!/usr/bin/env python3
import importlib.util, io, re, zipfile, xml.etree.ElementTree as ET
from pathlib import Path

spec = importlib.util.spec_from_file_location("fix", Path("scripts/fix_audiveris_mxl.py"))
fix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fix)

z = zipfile.ZipFile("_smoke/omr-work-b3a37755-full/audiveris_raw.mxl")
c = z.read("META-INF/container.xml").decode()
rf = re.search(r'full-path="([^"]+)"', c).group(1)
root = ET.parse(io.BytesIO(z.read(rf))).getroot()
ns = re.match(r"\{(.*)\}", root.tag).group(1) if re.match(r"\{(.*)\}", root.tag) else ""
part = [p for p in root.findall(fix.qname(ns, "part")) if p.get("id") == "P5"][0]
max_staff = fix._max_staff_in_part(part, ns)
for measure, div, exp in fix._iter_measures_with_timing(part, ns):
    if measure.get("number") not in ("42", "44"):
        continue
    print(f"=== m{measure.get('number')} div={div} exp={exp}")
    for (_, voice), groups in fix._voice_groups(measure, ns).items():
        if voice != "5" and measure.get("number") == "42":
            continue
        total = sum(fix._note_duration(g[0], ns) or 0 for g in groups)
        print(f" voice {voice} total={total}")
        for i, g in enumerate(groups):
            n = g[0]
            p = fix._pitch_label(n, ns) or "R"
            tm = n.find(fix.qname(ns, "time-modification")) is not None
            stem = fix._stem_from_note(n, ns)
            print(f"  {i}: {p} dur={fix._note_duration(n, ns)} tm={tm} stem={stem}")
