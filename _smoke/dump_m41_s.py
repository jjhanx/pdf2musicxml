#!/usr/bin/env python3
import io, re, zipfile, sys
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix
import xml.etree.ElementTree as ET

RAW = "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"
with zipfile.ZipFile(RAW) as z:
    c = z.read("META-INF/container.xml").decode()
    m = re.search(r'full-path="([^"]+)"', c)
    root = ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()
ns = fix.mxl_ns_uri(root)
for pi, label in [(1, "S"), (2, "A"), (3, "T"), (4, "B"), (4, "PR")]:
    part = root.findall(".//" + fix.qname(ns, "part"))[pi]
    for measure, div, exp in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != "41":
            continue
        print(f"--- {label} mxl41 exp={exp} ---")
        for g in fix._iter_chord_groups(measure, ns):
            n = g[0]
            p = "rest" if fix._is_rest(n, ns) else fix._pitch_label(n, ns)
            print(f" v{g[3]} {fix._note_type_text(n,ns):8s} d={fix._note_duration(n,ns)} {p} x={n.get('default-x')}")
