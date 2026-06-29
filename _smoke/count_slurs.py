#!/usr/bin/env python3
import io, re, sys, zipfile
import xml.etree.ElementTree as ET

path, pid = sys.argv[1], sys.argv[2]
measures = sys.argv[3:] if len(sys.argv) > 3 else ["6", "20", "30"]
with zipfile.ZipFile(path) as z:
    c = z.read("META-INF/container.xml").decode()
    rf = re.search(r'full-path="([^"]+)"', c).group(1)
    root = ET.parse(io.BytesIO(z.read(rf))).getroot()
for part in root:
    if not part.tag.endswith("part") or part.get("id") != pid:
        continue
    for meas in part:
        if not meas.tag.endswith("measure") or meas.get("number") not in measures:
            continue
        slurs = [el for el in meas.iter() if el.tag.endswith("slur")]
        print(f"m{meas.get('number')}: {len(slurs)} slurs")
