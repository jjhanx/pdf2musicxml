#!/usr/bin/env python3
import copy
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

RAW = "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"

with zipfile.ZipFile(RAW) as z:
    c = z.read("META-INF/container.xml").decode()
    m = re.search(r'full-path="([^"]+)"', c)
    root = ET.fromstring(z.read(m.group(1)))
ns = fix.mxl_ns_uri(root)

part = root.findall(".//" + fix.qname(ns, "part"))[4]
for measure, div, exp in fix._iter_measures_with_timing(part, ns):
    if measure.get("number") != "24":
        continue
    print("exp", exp)
    staff = "1"
    groups = fix._staff_chronological_groups(measure, ns, staff)
    for i, g in enumerate(groups[:5]):
        n = g[0]
        print(i, "v" + g[3], fix._note_type_text(n, ns), fix._note_duration(n, ns), n.get("default-x"))
    g0, g1, g2 = groups[0], groups[1], groups[2]
    voice = g0[3]
    voice_total = sum(
        fix._note_duration(g[0], ns) or 0
        for g in fix._voice_groups(measure, ns)[(staff, voice)]
    )
    staff_total = fix._staff_pitched_duration_sum(measure, ns, staff)
    print("v1 total", voice_total, "staff total", staff_total)
    print("g0 g1 same voice", g0[3] == g1[3])
    print("match pattern", (
        fix._is_plain_quarter_group(g0[0], ns, div)
        and fix._is_plain_quarter_group(g1[0], ns, div)
        and fix._is_plain_eighth_group(g2[0], ns, div)
        and fix._note_has_beam(g2[0], ns)
    ))
    mc = copy.deepcopy(measure)
    n = fix._repair_leading_quarter_pair_on_staff(mc, ns, div, exp)
    print("repair fired", n)
    if n:
        for g in fix._iter_chord_groups(mc, ns):
            if g[2] != staff or g[3] != "1":
                continue
            n = g[0]
            print(" v1", fix._note_type_text(n, ns), [b.text for b in n.findall(fix.qname(ns, "beam"))])
