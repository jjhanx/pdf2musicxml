#!/usr/bin/env python3
"""dynamics direction과 잇단 노트의 default-x·staff 비교."""
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

path = sys.argv[1]
with zipfile.ZipFile(path) as z:
    container = z.read("META-INF/container.xml").decode("utf-8")
    rootfile = re.search(r'full-path="([^"]+)"', container).group(1)
    data = z.read(rootfile)

root = ET.parse(io.BytesIO(data)).getroot()
m = re.match(r"\{(.*)\}", root.tag)
ns = m.group(1) if m else ""
q = lambda t: f"{{{ns}}}{t}" if ns else t
txt = lambda el: el.text.strip() if el is not None and el.text else None

for part in root.findall(q("part")):
    pid = part.get("id")
    for measure in part.findall(q("measure")):
        mnum = measure.get("number")
        dyn_dirs = []
        for d in measure.findall(q("direction")):
            for dt in d.findall(q("direction-type")):
                for dyn in dt.findall(q("dynamics")):
                    kinds = [c.tag.split("}")[-1] for c in dyn]
                    staff = txt(d.find(q("staff")))
                    dyn_dirs.append((d, kinds, dyn.get("default-x"), dyn.get("default-y"), staff, d.get("placement")))
        if not dyn_dirs:
            continue
        tm_info = []
        for n in measure.findall(q("note")):
            if n.find(q("time-modification")) is not None:
                tm_info.append((txt(n.find(q("staff"))) or "1", n.get("default-x")))
        for _, kinds, dx, dy, staff, plc in dyn_dirs:
            print(f"{pid} m{mnum}: dyn={kinds} x={dx} y={dy} staff={staff} plc={plc}")
        if tm_info:
            xs = {}
            for s, x in tm_info:
                xs.setdefault(s, []).append(x)
            for s, vals in xs.items():
                print(f"    tm notes staff={s}: x={vals}")
