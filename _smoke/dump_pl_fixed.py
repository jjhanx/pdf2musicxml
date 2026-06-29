#!/usr/bin/env python3
import io, re, sys, zipfile
import xml.etree.ElementTree as ET
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

RAW = "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"
with zipfile.ZipFile(RAW) as z:
    rb = z.read(re.search(r'full-path="([^"]+)"', z.read("META-INF/container.xml").decode()).group(1))
out, stats = fix.fix_score_xml(rb)
root = ET.fromstring(out)
ns = fix.mxl_ns_uri(root)
part = root.findall(".//" + fix.qname(ns, "part"))[4]
for measure, _, _ in fix._iter_measures_with_timing(part, ns):
    if measure.get("number") != "44":
        continue
    print("PL m44 fixed staff2:")
    for g in fix._iter_chord_groups(measure, ns):
        if g[2] != "2":
            continue
        n = g[0]
        t = fix._note_type_text(n, ns)
        if fix._is_rest(n, ns):
            t = "R-" + t
        tm = n.find(fix.qname(ns, "time-modification")) is not None
        print(f"  {t} d={fix._note_duration(n,ns)} tm={tm} x={n.get('default-x')} nchord={len(g[1])}")
