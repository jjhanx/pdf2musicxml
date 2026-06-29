#!/usr/bin/env python3
"""tm 노트 묶음과 tuplet 요소 유무 분포."""
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
    divisions = None
    for measure in part.findall(q("measure")):
        for attr in measure.findall(q("attributes")):
            d = attr.find(q("divisions"))
            if txt(d):
                divisions = int(txt(d))
        rows = []
        for n in measure.findall(q("note")):
            if n.find(q("chord")) is not None:
                continue
            tm = n.find(q("time-modification"))
            if tm is None:
                continue
            tuplets = [
                t.get("type")
                for nt in n.findall(q("notations"))
                for t in nt.findall(q("tuplet"))
            ]
            sv = (txt(n.find(q("staff"))) or "1") + "/" + (txt(n.find(q("voice"))) or "1")
            rows.append((sv, txt(n.find(q("duration"))), tuplets))
        if rows:
            print(f"{pid} m{measure.get('number')} div={divisions}: " + " ".join(
                f"[{sv} d={d} tup={tp}]" for sv, d, tp in rows))
