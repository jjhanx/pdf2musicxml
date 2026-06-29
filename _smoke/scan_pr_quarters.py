#!/usr/bin/env python3
"""Scan PR staff1 m41-45 for quarter-pair misreads."""
import io, re, zipfile, xml.etree.ElementTree as ET
import sys
sys.path.insert(0, "scripts")
from fix_audiveris_mxl import _voice_groups, _note_duration, _is_plain_quarter_group, _is_plain_eighth_group, qname

def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        return ET.parse(io.BytesIO(z.read(rf))).getroot()

for label in ("RAW", "FIX"):
    path = f"_smoke/omr-work-a26ecec0-full/{'audiveris_raw' if label=='RAW' else 'test_fixed'}.mxl"
    root = load(path)
    ns = re.match(r"\{(.*)\}", root.tag).group(1)
    part = [p for p in root.findall(f"{{{ns}}}part") if p.get("id") == "P5"][0]
    print(f"\n=== {label} ===")
    for mn in range(41, 46):
        m = part.find(f".//{{{ns}}}measure[@number='{mn}']")
        div = exp = None
        for attr in m.findall(f"{{{ns}}}attributes"):
            d = attr.find(f"{{{ns}}}divisions")
            if d is not None: div = int(d.text)
        if div is None:
            for pm in part.findall(f"{{{ns}}}measure"):
                if int(pm.get("number")) >= mn: break
                for attr in pm.findall(f"{{{ns}}}attributes"):
                    d = attr.find(f"{{{ns}}}divisions")
                    if d is not None: div = int(d.text)
        # time sig 4/4
        exp = div * 4 if div else 48
        for (staff, voice), groups in _voice_groups(m, ns).items():
            if staff != "1":
                continue
            total = sum(_note_duration(g[0], ns) or 0 for g in groups)
            q0 = _is_plain_quarter_group(groups[0][0], ns, div) if groups else False
            q1 = len(groups) > 1 and _is_plain_quarter_group(groups[1][0], ns, div)
            e0 = _is_plain_eighth_group(groups[0][0], ns, div) if groups else False
            print(f"m{mn} v{voice} total={total} exp={exp} g0={'Q' if q0 else ('e' if e0 else '?')} g1={'Q' if q1 else '?'}")
