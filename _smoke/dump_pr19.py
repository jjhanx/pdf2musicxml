#!/usr/bin/env python3
import io, re, zipfile, sys
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix
import xml.etree.ElementTree as ET

path = sys.argv[1] if len(sys.argv) > 1 else "_smoke/reg_check.mxl"
with zipfile.ZipFile(path) as z:
    c = z.read("META-INF/container.xml").decode()
    m = re.search(r'full-path="([^"]+)"', c)
    root = ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()
ns = fix.mxl_ns_uri(root)
part = root.findall(".//" + fix.qname(ns, "part"))[4]
for mnum in ("17", "18"):
    for measure, _, _ in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != mnum:
            continue
        print(f"mxl{mnum} staff1:")
        for i, g in enumerate(x for x in fix._iter_chord_groups(measure, ns) if x[2] == "1"):
            n = g[0]
            print(f" g{i} {fix._note_type_text(n, ns)} {fix._pitch_label(n, ns) or 'rest'}")
