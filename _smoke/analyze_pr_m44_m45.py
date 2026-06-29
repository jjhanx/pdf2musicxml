#!/usr/bin/env python3
import importlib.util, io, re, zipfile, xml.etree.ElementTree as ET
from pathlib import Path

spec = importlib.util.spec_from_file_location("fix", Path("scripts/fix_audiveris_mxl.py"))
fix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fix)

z = zipfile.ZipFile("_smoke/omr-work-6855d546-full/audiveris_raw.mxl")
c = z.read("META-INF/container.xml").decode()
rf = re.search(r'full-path="([^"]+)"', c).group(1)
root = ET.parse(io.BytesIO(z.read(rf))).getroot()
ns = root.tag[1 : root.tag.index("}")] if root.tag.startswith("{") else ""
part = [p for p in root.findall(f"{{{ns}}}part") if p.get("id") == "P5"][0]
for mno in ["44", "45"]:
    for measure, div, exp in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != mno:
            continue
        print(f"=== XML m{mno} div={div} exp={exp}")
        for (st, vo), groups in fix._voice_groups(measure, ns).items():
            if st != "1":
                continue
            total = sum(fix._note_duration(g[0], ns) or 0 for g in groups)
            print(f" PR total={total} groups={len(groups)}")
            for i, g in enumerate(groups):
                print(
                    f"  {i}",
                    fix._chord_pitch_signature(g, ns),
                    fix._note_type_text(g[0], ns),
                    fix._note_duration(g[0], ns),
                    "beam" if fix._note_has_beam(g[0], ns) else "-",
                )
