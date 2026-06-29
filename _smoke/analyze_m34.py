#!/usr/bin/env python3
import zipfile, re, io, sys
import xml.etree.ElementTree as ET
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

z = zipfile.ZipFile("_smoke/omr-work-2e86a8e0/audiveris_raw.mxl")
c = z.read("META-INF/container.xml").decode()
rf = re.search(r'full-path="([^"]+)"', c).group(1)
root = ET.parse(io.BytesIO(z.read(rf))).getroot()
ns = fix.mxl_ns_uri(root)
part = [p for p in root.findall(fix.qname(ns, "part")) if p.get("id") == "P4"][0]
div = beats = bt = None
for m in part.findall(fix.qname(ns, "measure")):
    for a in m.findall(fix.qname(ns, "attributes")):
        d = a.find(fix.qname(ns, "divisions"))
        if d is not None: div = int(d.text)
        t = a.find(fix.qname(ns, "time"))
        if t is not None:
            beats = int(t.find(fix.qname(ns, "beats")).text)
            bt = int(t.find(fix.qname(ns, "beat-type")).text)
    if m.get("number") == "34":
        exp = div * beats * 4 // bt
        print("m34 div", div, "time", beats, bt, "expected", exp)
        for (_, v), grps in fix._voice_groups(m, ns).items():
            total = sum(fix._note_duration(g[0], ns) or 0 for g in grps)
            print("voice", v, "groups", len(grps), "total", total)
            for g in grps:
                print(" ", fix._pitch_label(g[0], ns) or "R", fix._note_duration(g[0], ns))
