#!/usr/bin/env python3
import importlib.util, io, re, zipfile, xml.etree.ElementTree as ET
from pathlib import Path

spec = importlib.util.spec_from_file_location("fix", Path("scripts/fix_audiveris_mxl.py"))
fix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fix)

for label, mxl in [
    ("fixed", "_smoke/omr-work-6855d546-full/test_fixed.mxl"),
]:
    z = zipfile.ZipFile(mxl)
    c = z.read("META-INF/container.xml").decode()
    rf = re.search(r'full-path="([^"]+)"', c).group(1)
    root = ET.parse(io.BytesIO(z.read(rf))).getroot()
    ns = re.match(r"\{(.*)\}", root.tag).group(1) if re.match(r"\{(.*)\}", root.tag) else ""
    part = [p for p in root.findall(fix.qname(ns, "part")) if p.get("id") == "P5"][0]
    for measure, div, exp in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != "44":
            continue
        for (staff, voice), groups in fix._voice_groups(measure, ns).items():
            if staff != "2":
                continue
            total = sum(fix._note_duration(g[0], ns) or 0 for g in groups)
            print(label, f"staff2 total={total} exp={exp} groups={len(groups)}")
