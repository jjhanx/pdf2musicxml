#!/usr/bin/env python3
import io, re, sys, zipfile, xml.etree.ElementTree as ET
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

def load(p):
    with zipfile.ZipFile(p) as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        return ET.parse(io.BytesIO(z.read(rf))).getroot()

path = sys.argv[1]
root = load(path)
m = re.match(r"\{(.*)\}", root.tag)
ns = m.group(1) if m else ""
part = [x for x in root.findall(fix.qname(ns, "part")) if x.get("id") == "P5"][0]
for measure in part.findall(fix.qname(ns, "measure")):
    if measure.get("number") != "28":
        continue
    print(path)
    for i, g in enumerate(fix._iter_chord_groups(measure, ns), 1):
        n = g[0]
        dur = fix._note_duration(n, ns)
        tm = n.find(fix.qname(ns, "time-modification")) is not None
        pitches = [fix._pitch_label(x, ns) for x in g[1]]
        stem = fix._stem_direction(n, ns)
        beams = [b.text for b in n.findall(fix.qname(ns, "beam"))]
        print(f" {i}: staff{g[2]} v{g[3]} dur={dur} tm={tm} stem={stem} beam={beams} {pitches}")
