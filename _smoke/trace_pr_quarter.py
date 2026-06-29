#!/usr/bin/env python3
import importlib.util, copy, re, zipfile, xml.etree.ElementTree as ET
from pathlib import Path

spec = importlib.util.spec_from_file_location("fix", Path("scripts/fix_audiveris_mxl.py"))
fix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fix)

def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        return ET.parse(io.BytesIO(z.read(rf))).getroot()

import io

root = load("_smoke/omr-work-a26ecec0-full/audiveris_raw.mxl")
ns = re.match(r"\{(.*)\}", root.tag).group(1) if re.match(r"\{(.*)\}", root.tag) else ""
part = [p for p in root.findall(fix.qname(ns, "part")) if p.get("id") == "P5"][0]
max_staff = fix._max_staff_in_part(part, ns)
for mn in ("41", "42", "43", "44", "45"):
    for measure, div, exp in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != mn:
            continue
        m = copy.deepcopy(measure)
        for (_, v), groups in fix._voice_groups(m, ns).items():
            total = sum(fix._note_duration(g[0], ns) or 0 for g in groups)
            if total != exp:
                print(f"m{mn} voice {v} total={total} exp={exp}")
        n = fix._repair_quarter_pair_after_beam_run(m, ns, div, exp)
        if n:
            print(f"m{mn} quarter_pair_after_beam -> {n}")
        n2 = fix._repair_quarter_pair_before_eighths(m, ns, div, exp)
        if n2:
            print(f"m{mn} quarter_pair_before_eighth -> {n2}")
