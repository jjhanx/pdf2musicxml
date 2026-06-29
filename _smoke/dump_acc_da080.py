#!/usr/bin/env python3
import io, re, sys, zipfile, xml.etree.ElementTree as ET
path = sys.argv[1]
with zipfile.ZipFile(path) as z:
    rf = re.search(r'full-path="([^"]+)"', z.read("META-INF/container.xml").decode()).group(1)
    root = ET.parse(io.BytesIO(z.read(rf))).getroot()
m = re.match(r"\{(.*)\}", root.tag)
ns = m.group(1) if m else ""
q = lambda t: f"{{{ns}}}{t}" if ns else t
print("===", path)
for part in root.findall(q("part")):
    if part.get("id") != "P5":
        continue
    for measure in part.findall(q("measure")):
        if measure.get("number") not in ("48", "50"):
            continue
        print("m" + measure.get("number"))
        for n in measure.findall(q("note")):
            st = n.find(q("staff"))
            if st is not None and st.text != "1":
                continue
            p = n.find(q("pitch"))
            if p is None:
                continue
            s = p.find(q("step")).text
            o = p.find(q("octave")).text
            a = p.find(q("alter"))
            alt = a.text if a is not None else None
            ac = n.find(q("accidental"))
            acs = ac.text if ac is not None else None
            ch = "+" if n.find(q("chord")) is not None else " "
            print(f"  {ch}{s}{o} alter={alt} acc={acs}")
