#!/usr/bin/env python3
"""tie 검증: 지정 마디 경계의 tie start/stop 상태 덤프."""
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
def q(t):
    return f"{{{ns}}}{t}" if ns else t

def txt(el):
    return el.text.strip() if el is not None and el.text else None

def pitch(n):
    p = n.find(q("pitch"))
    if p is None:
        return "R"
    s, o = txt(p.find(q("step"))), txt(p.find(q("octave")))
    a = txt(p.find(q("alter")))
    acc = {"1": "#", "-1": "b"}.get(a, "") if a else ""
    return f"{s}{acc}{o}"

targets = ["6", "7", "20", "21", "22", "23", "24"]
for part in root.findall(q("part")):
    if part.get("id") != "P5":
        continue
    for measure in part.findall(q("measure")):
        if measure.get("number") not in targets:
            continue
        items = []
        for n in measure.findall(q("note")):
            ties = ",".join(t.get("type") for t in n.findall(q("tie")))
            tieds = ",".join(
                t.get("type")
                for nt in n.findall(q("notations"))
                for t in nt.findall(q("tied"))
            )
            sv = (txt(n.find(q("staff"))) or "1") + "/" + (txt(n.find(q("voice"))) or "1")
            mark = f"[tie:{ties}|tied:{tieds}]" if ties or tieds else ""
            ch = "+" if n.find(q("chord")) is not None else ""
            items.append(f"{ch}{pitch(n)}({txt(n.find(q('duration')))})[{sv}]{mark}")
        print(f"m{measure.get('number')}: " + " ".join(items))
