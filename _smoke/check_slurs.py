#!/usr/bin/env python3
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET


def slurs(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        root = ET.parse(io.BytesIO(z.read(rf))).getroot()
    m = re.match(r"\{(.*)\}", root.tag)
    ns = m.group(1) if m else ""
    q = lambda t: f"{{{ns}}}{t}"
    out = {}
    for part in root.findall(q("part")):
        if part.get("id") != "P5":
            continue
        for m in part.findall(q("measure")):
            mn = m.get("number")
            if mn not in {"6", "7", "20", "21", "29", "30", "44", "39", "40"}:
                continue
            s = []
            for n in m.findall(q("note")):
                st = n.find(q("staff"))
                st = st.text if st is not None else "1"
                if st != "1":
                    continue
                p = n.find(q("pitch"))
                if p is None:
                    continue
                step = p.find(q("step")).text
                oct_ = p.find(q("octave")).text
                al = p.find(q("alter"))
                alt = al.text if al is not None else ""
                sl = [x.get("type") for x in n.findall(".//" + q("slur"))]
                if sl:
                    s.append(f"{step}{alt}{oct_}:{sl}")
            if s:
                out[mn] = s
    return out


for p in sys.argv[1:]:
    print("===", p)
    for k, v in sorted(slurs(p).items(), key=lambda x: int(x[0])):
        print(f" m{k}: {v}")
