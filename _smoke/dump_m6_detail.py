#!/usr/bin/env python3
import io, re, sys, zipfile, xml.etree.ElementTree as ET

def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        return ET.parse(io.BytesIO(z.read(rf))).getroot()

def q(ns, t):
    return f"{{{ns}}}{t}" if ns else t

def txt(el):
    return el.text.strip() if el is not None and el.text else ""

def pitch(n, ns):
    p = n.find(q(ns, "pitch"))
    if p is None:
        return "R"
    s, o = txt(p.find(q(ns, "step"))), txt(p.find(q(ns, "octave")))
    a = txt(p.find(q(ns, "alter")))
    acc = {"1": "#", "-1": "b"}.get(a, "") if a else ""
    return f"{s}{acc}{o}"

path = sys.argv[1]
mn = sys.argv[2]
root = load(path)
m = re.match(r"\{(.*)\}", root.tag)
ns = m.group(1) if m else ""
for part in root.findall(q(ns, "part")):
    if part.get("id") != "P5":
        continue
    measure = part.find(f".//{q(ns,'measure')}[@number='{mn}']")
    if measure is None:
        continue
    print(f"=== m{mn} ===")
    i = 0
    for n in measure.findall(q(ns, "note")):
        ch = n.find(q(ns, "chord")) is not None
        typ = txt(n.find(q(ns, "type")))
        dur = txt(n.find(q(ns, "duration")))
        stem = txt(n.find(q(ns, "stem"))) or "-"
        sl = [(s.get("number"), s.get("type"), s.get("placement")) for s in n.findall(".//"+q(ns,"slur"))]
        print(f"  {i:2} {'ch' if ch else 'nt'} {pitch(n,ns)} {typ}({dur}) stem={stem} slur={sl}")
        if not ch:
            i += 1
