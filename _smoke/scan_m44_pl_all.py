#!/usr/bin/env python3
"""Compare XML m44 staff2 (printed 45 PL) across omr-work samples."""
import importlib.util
import io
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

spec = importlib.util.spec_from_file_location("fix", Path("scripts/fix_audiveris_mxl.py"))
fix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fix)


def analyze_mxl(path: Path) -> dict | None:
    try:
        z = zipfile.ZipFile(path)
    except Exception:
        return None
    c = z.read("META-INF/container.xml").decode()
    rf = re.search(r'full-path="([^"]+)"', c).group(1)
    root = ET.parse(io.BytesIO(z.read(rf))).getroot()
    ns = root.tag[1 : root.tag.index("}")] if root.tag.startswith("{") else ""
    part = None
    for p in root.findall(fix.qname(ns, "part")):
        if p.get("id") == "P5":
            part = p
            break
    if part is None:
        return None
    for measure, div, exp in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != "44":
            continue
        for (staff, voice), groups in fix._voice_groups(measure, ns).items():
            if staff != "2":
                continue
            q = t = 0
            for g in groups:
                if g[0].find(fix.qname(ns, "time-modification")) is not None:
                    t += 1
                elif fix._note_type_text(g[0], ns) == "quarter":
                    q += 1
            total = sum(fix._note_duration(g[0], ns) or 0 for g in groups)
            return {
                "groups": len(groups),
                "quarters": q,
                "triplet_slices": t,
                "total": total,
                "exp": exp,
                "div": div,
            }
    return None


root = Path("_smoke")
for d in sorted(root.glob("omr-work-*-full")):
    for name in ("audiveris_raw.mxl", "review.mxl", "test_fixed.mxl"):
        p = d / name
        if not p.is_file():
            continue
        info = analyze_mxl(p)
        if info:
            print(
                f"{d.name}/{name}: groups={info['groups']} Q={info['quarters']} T={info['triplet_slices']} total={info['total']}/{info['exp']}"
            )
