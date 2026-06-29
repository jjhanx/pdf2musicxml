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
for mnum in ("18", "44"):
    for measure, _, _ in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != mnum:
            continue
        print(f"PL mxl{mnum} staff2:")
        for i, g in enumerate(g for g in fix._iter_chord_groups(measure, ns) if g[2] == "2"):
            el = g[0]
            tm = el.find(fix.qname(ns, "time-modification")) is not None
            p = fix._pitch_label(el, ns) or ("rest" if fix._is_rest(el, ns) else "?")
            print(f"  g{i} {fix._note_type_text(el, ns)} {'tri' if tm else '   '} {p}")
