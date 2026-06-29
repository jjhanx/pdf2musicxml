#!/usr/bin/env python3
import importlib.util, io, re, sys, zipfile, xml.etree.ElementTree as ET
from pathlib import Path

spec = importlib.util.spec_from_file_location("fix", Path("scripts/fix_audiveris_mxl.py"))
fix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fix)

def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        root = ET.parse(io.BytesIO(z.read(rf))).getroot()
    m = re.match(r"\{(.*)\}", root.tag)
    ns = m.group(1) if m else ""
    return root, ns

path = sys.argv[1]
root, ns = load(path)
for part in root.findall(fix.qname(ns, "part")):
    if part.get("id") != "P5":
        continue
    max_staff = fix._max_staff_in_part(part, ns)
    for measure, div, exp in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != "28":
            continue
        print("div", div, "exp", exp)
        for (_, voice), groups in fix._voice_groups(measure, ns).items():
            print("voice", voice, "ngroups", len(groups))
            for i, g in enumerate(groups):
                n = g[0]
                p = fix._pitch_label(n, ns) or "R"
                dur = fix._note_duration(n, ns)
                typ = fix._note_type_text(n, ns)
                stacc = fix._note_has_staccato(n, ns)
                beams = [b.text for b in n.findall(fix.qname(ns, "beam"))]
                print(f"  {i}: {p} {typ}({dur}) stacc={stacc} beam={beams} staff={g[2]}")
        m = measure
        for name, fn in [
            ("general_resolve", lambda: fix._general_resolve_overfull_measure(m, ns, max_staff, div, exp)),
            ("rest_eighth", lambda: fix._repair_eighth_rest_plus_two_eighths_triplet(m, ns, max_staff, div, exp)),
            ("three_eighth", lambda: fix._repair_three_eighths_as_triplet(m, ns, max_staff, div)),
        ]:
            n = fn()
            print(name, "->", n)
            if n:
                for (_, voice), groups in fix._voice_groups(m, ns).items():
                    for i, g in enumerate(groups):
                        n0 = g[0]
                        p = fix._pitch_label(n0, ns) or "R"
                        tm = n0.find(fix.qname(ns, "time-modification")) is not None
                        print(f"   after {i}: {p} tm={tm}")
