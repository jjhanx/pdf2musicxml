#!/usr/bin/env python3
import io, re, sys, zipfile
import xml.etree.ElementTree as ET
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

RAW = "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"
with zipfile.ZipFile(RAW) as z:
    root = ET.fromstring(z.read(re.search(r'full-path="([^"]+)"', z.read("META-INF/container.xml").decode()).group(1)))
ns = fix.mxl_ns_uri(root)

def dump(pi, mnum, staff="1", voice=None):
    part = root.findall(".//" + fix.qname(ns, "part"))[pi]
    for measure, _, _ in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != mnum:
            continue
        print(f"P{pi+1} m{mnum} staff{staff}")
        for g in fix._iter_chord_groups(measure, ns):
            if g[2] != staff or (voice and g[3] != voice):
                continue
            n = g[0]
            t = fix._note_type_text(n, ns)
            b = [x.text for x in n.findall(fix.qname(ns, "beam"))]
            p = n.find(fix.qname(ns, "pitch"))
            ps = (p.find(fix.qname(ns,"step")).text + p.find(fix.qname(ns,"octave")).text) if p is not None else "R"
            print(f"  {t} d={fix._note_duration(n,ns)} {ps} b={b} x={n.get('default-x')}")

dump(4, "44", "1", "1")  # m45 PR
dump(4, "43", "1", "1")  # check m44
