#!/usr/bin/env python3
"""Count chord groups per staff/voice; flag measures with late quarter pairs."""
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

mxl = sys.argv[1] if len(sys.argv) > 1 else "_smoke/omr-work-2e86a8e0/audiveris_raw.mxl"
with zipfile.ZipFile(mxl) as z:
    c = z.read("META-INF/container.xml").decode()
    rf = re.search(r'full-path="([^"]+)"', c).group(1)
    root = ET.parse(io.BytesIO(z.read(rf))).getroot()
m = re.match(r"\{(.*)\}", root.tag)
ns = m.group(1) if m else ""
q = lambda t: f"{{{ns}}}{t}" if ns else t


def groups_for(measure, staff, voice):
    out = []
    cur = None
    for child in measure:
        if child.tag.split("}")[-1] != "note":
            continue
        v = child.find(q("voice"))
        s = child.find(q("staff"))
        vv = v.text if v is not None else "1"
        ss = s.text if s is not None else "1"
        if vv != voice or ss != staff:
            continue
        if child.find(q("chord")) is not None:
            if cur:
                cur[1].append(child)
            continue
        cur = (child, [child])
        out.append(cur)
    return out


part = [p for p in root.findall(q("part")) if p.get("id") == "P5"][0]
for measure in part.findall(q("measure")):
    mnum = int(measure.get("number"))
    for staff, voice in [("1", "1"), ("2", "5")]:
        grps = groups_for(measure, staff, voice)
        if len(grps) < 6:
            continue
        labels = []
        for leader, _ in grps:
            typ = fix._note_type_text(leader, ns)
            beams = [b.text for b in leader.findall(q("beam"))]
            labels.append(f"{typ}{'b' if beams else ''}")
        q_at = [i for i, g in enumerate(grps) if fix._note_type_text(g[0], ns) == "quarter" and g[0].find(q("dot")) is None]
        if len(q_at) >= 2 and any(i >= 5 for i in q_at):
            print(f"m{mnum} s{staff} v{voice} n={len(grps)} labels={labels}")
