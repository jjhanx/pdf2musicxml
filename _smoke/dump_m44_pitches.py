#!/usr/bin/env python3
import io, re, sys, zipfile, xml.etree.ElementTree as ET

def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        return ET.parse(io.BytesIO(z.read(rf))).getroot()

def q(ns, t):
    return f"{{{ns}}}{t}"

def pitch(n, ns):
    p = n.find(q(ns, "pitch"))
    if p is None:
        return "R"
    s = p.find(q(ns, "step")).text
    o = p.find(q(ns, "octave")).text
    a = p.find(q(ns, "alter"))
    al = a.text if a is not None and a.text else ""
    acc = {"1": "#", "-1": "b"}.get(al, "")
    return f"{s}{acc}{o}"

path = sys.argv[1]
root = load(path)
m = re.match(r"\{(.*)\}", root.tag)
ns = m.group(1) if m else ""
for part in root.findall(q(ns, "part")):
    if part.get("id") != "P5":
        continue
    for measure in part.findall(q(ns, "measure")):
        if measure.get("number") != "44":
            continue
        print(path)
        for grp in __import__('fix_audiveris_mxl', fromlist=['_iter_chord_groups'])._iter_chord_groups(measure, ns):
            leader, notes, staff, voice = grp
            pitches = [pitch(n, ns) for n in notes]
            dur = leader.find(q(ns, "duration")).text
            typ = leader.find(q(ns, "type")).text
            tm = leader.find(q(ns, "time-modification")) is not None
            print(f"  s{staff}v{voice} {typ}({dur}) tm={tm} {pitches}")
