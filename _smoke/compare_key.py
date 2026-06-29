#!/usr/bin/env python3
import io, re, zipfile, sys, copy
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix
import xml.etree.ElementTree as ET

RAW = "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"
OUT = "_smoke/reg_check.mxl"


def dump_part(root, pi, mnum, label):
    ns = fix.mxl_ns_uri(root)
    part = root.findall(".//" + fix.qname(ns, "part"))[pi]
    print(f"--- {label} mxl{mnum} ---")
    for measure, _, exp in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != mnum:
            continue
        total = sum(fix._note_duration(g[0], ns) or 0 for g in fix._iter_chord_groups(measure, ns))
        print(f"  total={total} exp={exp}")
        for g in fix._iter_chord_groups(measure, ns):
            n = g[0]
            p = "R-" + (fix._note_type_text(n, ns) or "?") if fix._is_rest(n, ns) else fix._pitch_label(n, ns)
            b = [x.text for x in n.findall(fix.qname(ns, "beam"))]
            print(f"  {fix._note_type_text(n,ns):8s} d={fix._note_duration(n,ns)} {p} b={b}")


with zipfile.ZipFile(RAW) as z:
    c = z.read("META-INF/container.xml").decode()
    m = re.search(r'full-path="([^"]+)"', c)
    raw = ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()
with zipfile.ZipFile(OUT) as z:
    c = z.read("META-INF/container.xml").decode()
    m = re.search(r'full-path="([^"]+)"', c)
    fixed = ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()

for mnum, cases in [("41", [(1, "S"), (2, "A")]), ("24", [(1, "S"), (2, "A"), (3, "T"), (4, "B")])]:
    print("RAW")
    for pi, lb in cases:
        dump_part(raw, pi, mnum, lb)
    print("FIX")
    for pi, lb in cases:
        dump_part(fixed, pi, mnum, lb)
