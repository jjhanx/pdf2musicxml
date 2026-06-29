#!/usr/bin/env python3
import io, re, zipfile, xml.etree.ElementTree as ET
z = zipfile.ZipFile("_smoke/omr-work-b3a37755-full/test_fixed.mxl")
c = z.read("META-INF/container.xml").decode()
rf = re.search(r'full-path="([^"]+)"', c).group(1)
root = ET.parse(io.BytesIO(z.read(rf))).getroot()
ns = re.match(r"\{(.*)\}", root.tag).group(1) if re.match(r"\{(.*)\}", root.tag) else ""
q = lambda t: f"{{{ns}}}{t}"
part = [p for p in root.findall(q("part")) if p.get("id") == "P5"][0]
m = part.find(f".//{q('measure')}[@number='6']")
for n in m.findall(q("note")):
    for s in n.findall(".//" + q("slur")):
        p = n.find(q("pitch"))
        lab = p.find(q("step")).text if p is not None else "R"
        print(lab, s.attrib)
