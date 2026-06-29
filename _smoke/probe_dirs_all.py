#!/usr/bin/env python3
import io, re, zipfile, xml.etree.ElementTree as ET
path = "_smoke/omr-work-a3276108-full/audiveris_raw.mxl"
with zipfile.ZipFile(path) as z:
    c = z.read("META-INF/container.xml").decode()
    rf = re.search(r'full-path="([^"]+)"', c).group(1)
    root = ET.parse(io.BytesIO(z.read(rf))).getroot()
m = re.match(r"\{(.*)\}", root.tag)
ns = m.group(1) if m else ""
q = lambda t: f"{{{ns}}}{t}" if ns else t

for part in root.findall(q("part")):
    if part.get("id") != "P5":
        continue
    for measure in part.findall(q("measure")):
        mn = measure.get("number")
        if mn not in {"6", "20", "30"}:
            continue
        for d in measure.findall(q("direction")):
            for dt in d.findall(q("direction-type")):
                for child in list(dt):
                    tag = child.tag.split("}")[-1]
                    t = (child.text or "").strip()
                    if t or tag not in ("words", "text"):
                        print(f"m{mn} dir {tag}: {t!r} attrs={dict(child.attrib)}")
