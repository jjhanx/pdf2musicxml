#!/usr/bin/env python3
"""Trace which repair touches m44 staff1/2."""
import copy, importlib.util
from pathlib import Path
import io, re, zipfile, xml.etree.ElementTree as ET

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
max_staff = fix._max_staff_in_part(part, ns)

def sig_staff(m, staff):
    for (st, voice), groups in fix._voice_groups(m, ns).items():
        if st != staff:
            continue
        return [fix._chord_pitch_signature(g, ns) for g in groups], sum(
            fix._note_duration(g[0], ns) or 0 for g in groups
        )

for measure, div, exp in fix._iter_measures_with_timing(part, ns):
    if measure.get("number") != "44":
        continue
    m = copy.deepcopy(measure)
    repairs = [
        ("swap", lambda: fix._repair_swap_leading_qq_with_beamed_pair(m, ns, div, exp)),
        ("leading_q", lambda: fix._repair_leading_quarter_pair(m, ns, div, exp)),
        ("qeq", lambda: fix._repair_quarter_eighth_quarter_lost_final(m, ns, div, exp)),
        ("qp_before", lambda: fix._repair_quarter_pair_before_eighths(m, ns, div, exp)),
        ("collapsed", lambda: fix._repair_two_collapsed_triplet_spans(m, ns, max_staff, div, exp)),
    ]
    for name, fn in repairs:
        before1, t1 = sig_staff(m, "1")
        before2, t2 = sig_staff(m, "2")
        n = fn()
        after1, ta1 = sig_staff(m, "1")
        after2, ta2 = sig_staff(m, "2")
        if n or before1 != after1 or before2 != after2:
            print(f"{name}: n={n}")
            if before1 != after1:
                print(f"  staff1 {len(before1)}->{len(after1)} {before1[:3]}... total {t1}->{ta1}")
            if before2 != after2:
                print(f"  staff2 {len(before2)}->{len(after2)} total {t2}->{ta2}")
