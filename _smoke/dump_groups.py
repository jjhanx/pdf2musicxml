#!/usr/bin/env python3
"""특정 part/measure의 그룹 요약 (staff/voice 포함). Args: mxl part measure"""
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

path, part_id, mnum = sys.argv[1], sys.argv[2], sys.argv[3]
with zipfile.ZipFile(path) as z:
    container = z.read("META-INF/container.xml").decode("utf-8")
    rootfile = re.search(r'full-path="([^"]+)"', container).group(1)
    data = z.read(rootfile)

root = ET.parse(io.BytesIO(data)).getroot()
m = re.match(r"\{(.*)\}", root.tag)
ns = m.group(1) if m else ""
q = lambda t: f"{{{ns}}}{t}" if ns else t
txt = lambda el: el.text.strip() if el is not None and el.text else None

def pitch(n):
    p = n.find(q("pitch"))
    if p is None:
        return "R"
    s, o = txt(p.find(q("step"))), txt(p.find(q("octave")))
    a = txt(p.find(q("alter")))
    acc = {"1": "#", "-1": "b"}.get(a, "") if a else ""
    return f"{s}{acc}{o}"

for part in root.findall(q("part")):
    if part.get("id") != part_id:
        continue
    for measure in part.findall(q("measure")):
        if measure.get("number") != mnum:
            continue
        for el in measure:
            tag = el.tag.split("}")[-1]
            if tag in ("backup", "forward"):
                print(f"{tag.upper()} {txt(el.find(q('duration')))}")
            elif tag == "note":
                ch = "+" if el.find(q("chord")) is not None else " "
                typ = txt(el.find(q("type"))) or "?"
                dot = "." if el.find(q("dot")) is not None else ""
                tmod = "T" if el.find(q("time-modification")) is not None else ""
                ties = ",".join(t.get("type") for t in el.findall(q("tie")))
                sv = (txt(el.find(q("staff"))) or "1") + "/" + (txt(el.find(q("voice"))) or "1")
                dur = txt(el.find(q("duration")))
                print(f" {ch}{pitch(el)} {typ}{dot}{tmod} dur={dur} [{sv}] {ties}")
            else:
                print(f"<{tag}>")
