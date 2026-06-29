#!/usr/bin/env python3
import io, re, sys, zipfile, xml.etree.ElementTree as ET

def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        return ET.parse(io.BytesIO(z.read(rf))).getroot()

def q(ns, t):
    return f"{{{ns}}}{t}"

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
        idx = 0
        for n in measure.findall(q(ns, "note")):
            st = n.find(q(ns, "staff"))
            if st is None or st.text != "2":
                continue
            if n.find(q(ns, "chord")) is not None:
                continue
            idx += 1
            tups = []
            for notations in n.findall(q(ns, "notations")):
                for t in notations.findall(q(ns, "tuplet")):
                    tups.append(t.get("type"))
            tm = n.find(q(ns, "time-modification")) is not None
            print(
                f"  s2#{idx}: dur={n.find(q(ns, 'duration')).text} "
                f"type={n.find(q(ns, 'type')).text} tm={tm} tuplet={tups}"
            )
