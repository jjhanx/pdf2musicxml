#!/usr/bin/env python3
import io, re, sys, zipfile, xml.etree.ElementTree as ET

def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        return ET.parse(io.BytesIO(z.read(rf))).getroot()

def q(ns, t):
    return f"{{{ns}}}{t}" if ns else t

path = sys.argv[1]
root = load(path)
m = re.match(r"\{(.*)\}", root.tag)
ns = m.group(1) if m else ""
for part in root.findall(q(ns, "part")):
    if part.get("id") != "P5":
        continue
    measure = part.find(f".//{q(ns,'measure')}[@number='28']")
    dyn = []
    for d in measure.findall(q(ns, "direction")):
        for dt in d.findall(".//" + q(ns, "dynamics")):
            dyn.append("".join(dt.itertext()).strip())
    print("dynamics", dyn)
    for n in measure.findall(q(ns, "note")):
        p = n.find(q(ns, "pitch"))
        lab = "R" if p is None else p.find(q(ns, "step")).text
        stacc = n.find(".//" + q(ns, "staccato")) is not None
        print(f"  {lab} stacc={stacc}")
