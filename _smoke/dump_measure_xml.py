#!/usr/bin/env python3
"""특정 part/measure의 원본 XML 덤프. Args: mxl part measure"""
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
ET.register_namespace("", ns)
q = lambda t: f"{{{ns}}}{t}" if ns else t
for part in root.findall(q("part")):
    if part.get("id") != part_id:
        continue
    for measure in part.findall(q("measure")):
        if measure.get("number") == mnum:
            xml = ET.tostring(measure, encoding="unicode")
            xml = re.sub(r' xmlns="[^"]*"', "", xml)
            print(xml)
