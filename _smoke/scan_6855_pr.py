#!/usr/bin/env python3
"""Scan PR staff1 m41-45 for quarter misreads and voice totals."""
import io, re, zipfile, xml.etree.ElementTree as ET
import sys
sys.path.insert(0, "scripts")
from fix_audiveris_mxl import _voice_groups, _note_duration, _is_plain_quarter_group, _is_plain_eighth_group

def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        root = ET.parse(io.BytesIO(z.read(rf))).getroot()
    ns = root.tag[1:root.tag.index("}")] if root.tag.startswith("{") else ""
    return root, ns

def expected_for(m, ns, div):
    exp = div * 4
    for attr in m.findall(f"{{{ns}}}attributes"):
        ts = attr.find(f"{{{ns}}}time")
        if ts is not None:
            beats = ts.find(f"{{{ns}}}beats")
            if beats is not None and beats.text.isdigit():
                exp = div * int(beats.text)
    return exp

for label, path in [("RAW", "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"), ("FIX", "_smoke/omr-work-6855d546-full/test_fixed.mxl")]:
    root, ns = load(path)
    part = [p for p in root.findall(f"{{{ns}}}part") if p.get("id") == "P5"][0]
    print(f"\n=== {label} ===")
    div = 12
    for pm in part.findall(f"{{{ns}}}measure"):
        if int(pm.get("number")) <= 40:
            for attr in pm.findall(f"{{{ns}}}attributes"):
                d = attr.find(f"{{{ns}}}divisions")
                if d is not None: div = int(d.text)
    for mn in range(41, 46):
        m = part.find(f".//{{{ns}}}measure[@number='{mn}']")
        exp = expected_for(m, ns, div)
        for (staff, voice), groups in _voice_groups(m, ns):
            if staff != "1":
                continue
            total = sum(_note_duration(g[0], ns) or 0 for g in groups)
            flags = []
            if total == exp + div:
                flags.append("OVER+1Q")
            if len(groups) >= 2 and _is_plain_quarter_group(groups[0][0], ns, div) and _is_plain_quarter_group(groups[1][0], ns, div):
                flags.append("Q-Q-start")
            if len(groups) >= 2 and _is_plain_eighth_group(groups[0][0], ns, div) and _is_plain_eighth_group(groups[1][0], ns, div):
                flags.append("e8-pair-start")
            print(f" m{mn} v{voice} total={total}/{exp} n={len(groups)} {' '.join(flags)}")
