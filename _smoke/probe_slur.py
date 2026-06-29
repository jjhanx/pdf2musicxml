#!/usr/bin/env python3
import io, re, sys, zipfile
import xml.etree.ElementTree as ET

path, pid, mnum, staff = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
with zipfile.ZipFile(path) as z:
    c = z.read("META-INF/container.xml").decode()
    rf = re.search(r'full-path="([^"]+)"', c).group(1)
    root = ET.parse(io.BytesIO(z.read(rf))).getroot()
ns = re.match(r"\{(.*)\}", root.tag).group(1) or ""
q = lambda t: f"{{{ns}}}{t}"

for part in root.findall(q("part")):
    if part.get("id") != pid:
        continue
    for measure in part.findall(q("measure")):
        if measure.get("number") != mnum:
            continue
        print(path, f"P{pid} m{mnum}")
        i = 0
        for el in measure:
            if el.tag.split("}")[-1] != "note":
                continue
            st = el.find(q("staff"))
            if (st.text if st is not None else "1") != staff:
                continue
            if el.find(q("chord")) is None:
                i += 1
            sl = []
            for nt in el.findall(q("notations")):
                for s in nt.findall(q("slur")):
                    sl.append(f"slur:{s.get('type')}")
            print(f" {i}: sl={sl}")
