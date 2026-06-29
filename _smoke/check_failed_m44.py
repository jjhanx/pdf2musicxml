#!/usr/bin/env python3
import importlib.util, io, re, zipfile, xml.etree.ElementTree as ET
from pathlib import Path
spec = importlib.util.spec_from_file_location("fix", Path("scripts/fix_audiveris_mxl.py"))
fix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fix)

for job in ["omr-work-8ba5b011-full", "omr-work-a26ecec0-full", "omr-work-a3276108-full"]:
    path = Path(f"_smoke/{job}/audiveris_raw.mxl")
    if not path.is_file():
        continue
    z = zipfile.ZipFile(path)
    c = z.read("META-INF/container.xml").decode()
    rf = re.search(r'full-path="([^"]+)"', c).group(1)
    root = ET.parse(io.BytesIO(z.read(rf))).getroot()
    ns = fix.mxl_ns_uri(root)
    part = [p for p in root.findall(fix.qname(ns, "part")) if p.get("id") == "P5"][0]
    for measure, div, exp in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != "44":
            continue
        for (staff, voice), groups in fix._voice_groups(measure, ns).items():
            if staff != "2":
                continue
            print(f"\n{job} voice={voice} groups={len(groups)}")
            for i, g in enumerate(groups[:4]):
                print(
                    f"  {i}: {fix._chord_pitch_signature(g, ns)} "
                    f"melodic={fix._is_melodic_false_chord_group(g, ns)} "
                    f"qmis={fix._is_misread_quarter_chord_for_triplet(g, ns, div)}"
                )
