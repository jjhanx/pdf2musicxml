#!/usr/bin/env python3
"""Diff m44 staff2 between raw and review for samples with 12T in review."""
import importlib.util
import io
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

spec = importlib.util.spec_from_file_location("fix", Path("scripts/fix_audiveris_mxl.py"))
fix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fix)


def dump_groups(path: Path, label: str) -> list:
    z = zipfile.ZipFile(path)
    c = z.read("META-INF/container.xml").decode()
    rf = re.search(r'full-path="([^"]+)"', c).group(1)
    root = ET.parse(io.BytesIO(z.read(rf))).getroot()
    ns = root.tag[1 : root.tag.index("}")] if root.tag.startswith("{") else ""
    part = [p for p in root.findall(fix.qname(ns, "part")) if p.get("id") == "P5"][0]
    for measure, div, exp in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != "44":
            continue
        for (staff, voice), groups in fix._voice_groups(measure, ns).items():
            if staff != "2":
                continue
            print(f"\n{label} ({path.parent.name}/{path.name}) groups={len(groups)}")
            for i, g in enumerate(groups):
                sig = fix._chord_pitch_signature(g, ns)
                typ = fix._note_type_text(g[0], ns)
                dur = fix._note_duration(g[0], ns)
                tm = g[0].find(fix.qname(ns, "time-modification")) is not None
                stem = fix._stem_from_note(g[0], ns)
                print(f"  {i}: {sig} {typ} dur={dur} tm={tm} stem={stem}")
            return groups
    return []


for job in ["omr-work-2273e5c1-full", "omr-work-b3a37755-full", "omr-work-6855d546-full"]:
    raw = Path(f"_smoke/{job}/audiveris_raw.mxl")
    rev = Path(f"_smoke/{job}/review.mxl")
    if raw.is_file():
        dump_groups(raw, "RAW")
    if rev.is_file():
        dump_groups(rev, "REVIEW")
