#!/usr/bin/env python3
import io, re, sys, zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

path = sys.argv[1] if len(sys.argv) > 1 else "_smoke/de9c_fixed.mxl"
with zipfile.ZipFile(path) as z:
    c = z.read("META-INF/container.xml").decode()
    m = re.search(r'full-path="([^"]+)"', c)
    root = ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()
ns = fix.mxl_ns_uri(root)
part = root.findall(".//" + fix.qname(ns, "part"))[4]
for measure, div, exp in fix._iter_measures_with_timing(part, ns):
    if measure.get("number") != "24":
        continue
    print(f"PR mxl24 exp={exp}")
    for g in fix._iter_chord_groups(measure, ns):
        if g[2] != "1":
            continue
        t = fix._note_type_text(g[0], ns) or "?"
        beams = [b.text for b in g[0].findall(fix.qname(ns, "beam"))]
        if fix._is_rest(g[0], ns):
            p = "rest"
        elif len(g[1]) > 1:
            p = "+".join(sorted(fix._pitch_label(n, ns) or "?" for n in g[1]))
        else:
            p = fix._pitch_label(g[0], ns) or "?"
        print(f"  v{g[3]} {t:8s} b={beams} {p}")
