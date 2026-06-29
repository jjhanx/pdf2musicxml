#!/usr/bin/env python3
import importlib.util, io, re, zipfile, xml.etree.ElementTree as ET
from pathlib import Path

spec = importlib.util.spec_from_file_location("fix", Path("scripts/fix_audiveris_mxl.py"))
fix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fix)

z = zipfile.ZipFile("_smoke/omr-work-2ffe8bd0-full/audiveris_raw.mxl")
c = z.read("META-INF/container.xml").decode()
rf = re.search(r'full-path="([^"]+)"', c).group(1)
root = ET.parse(io.BytesIO(z.read(rf))).getroot()
m = re.match(r"\{(.*)\}", root.tag)
ns = m.group(1) if m else ""
part = [p for p in root.findall(fix.qname(ns, "part")) if p.get("id") == "P5"][0]
for measure, div, exp in fix._iter_measures_with_timing(part, ns):
    if measure.get("number") != "28":
        continue
    eighth = div // 2
    triplet_saving = 3 * eighth - 3 * max(1, (eighth * 2) // 3)
    for (_, voice), groups in fix._voice_groups(measure, ns).items():
        total = sum(fix._note_duration(g[0], ns) or 0 for g in groups)
        print(f"voice {voice} total={total} need={exp + triplet_saving}")
        if voice != "5":
            continue
        g0, g1, g2 = groups[2], groups[3], groups[4]
        print("  p dyn", fix._measure_has_p_dynamic(measure, ns))
        print("  g1 stacc", any(fix._note_has_staccato(n, ns) for n in g1[1]))
        print("  g2 stacc", any(fix._note_has_staccato(n, ns) for n in g2[1]))
        cond = (any(fix._note_has_staccato(n, ns) for n in g1[1]) and any(fix._note_has_staccato(n, ns) for n in g2[1])) or fix._measure_has_p_dynamic(measure, ns)
        print("  would apply", cond)
