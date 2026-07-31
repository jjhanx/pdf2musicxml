#!/usr/bin/env python3
"""Extract P1 m24-28 snippet for OSMD node test."""
import xml.etree.ElementTree as ET
from pathlib import Path

def local(t):
    return t.split("}", 1)[-1]

src = Path("_smoke/_cheongsan_review.xml")
root = ET.parse(src).getroot()
# clone minimal score
out = ET.Element(root.tag, root.attrib)
part_list = root.find(".//{*}part-list")
if part_list is not None:
    out.append(ET.fromstring(ET.tostring(part_list)))
part = root.find('.//{*}part[@id="P1"]')
new_part = ET.Element(part.tag, part.attrib)
for meas in part:
    if local(meas.tag) != "measure":
        continue
    n = int(meas.get("number") or 0)
    if 24 <= n <= 28:
        new_part.append(ET.fromstring(ET.tostring(meas)))
out.append(new_part)
body = ET.tostring(out, encoding="unicode")
Path("_smoke/_cheongsan_p1_m24_28.xml").write_text(
    '<?xml version="1.0" encoding="UTF-8"?>\n' + body, encoding="utf-8"
)
print("written _smoke/_cheongsan_p1_m24_28.xml")
