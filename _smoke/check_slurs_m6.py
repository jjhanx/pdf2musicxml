#!/usr/bin/env python3
import io, re, sys, zipfile, xml.etree.ElementTree as ET

mxl = sys.argv[1] if len(sys.argv) > 1 else "_smoke/omr-work-6855d546-full/test_fixed.mxl"
z = zipfile.ZipFile(mxl)
c = z.read("META-INF/container.xml").decode()
rf = re.search(r'full-path="([^"]+)"', c).group(1)
root = ET.parse(io.BytesIO(z.read(rf))).getroot()
ns = re.match(r"\{(.*)\}", root.tag).group(1) if re.match(r"\{(.*)\}", root.tag) else ""
q = lambda t: f"{{{ns}}}{t}"
part = [p for p in root.findall(q("part")) if p.get("id") == "P5"][0]
for mno in ["6", "30"]:
    m = part.find(f".//{q('measure')}[@number='{mno}']")
    print(f"=== m{mno}")
    for n in m.findall(q("note")):
        p = n.find(q("pitch"))
        if p is None:
            continue
        lab = p.find(q("step")).text + p.find(q("octave")).text
        for s in n.findall(".//" + q("slur")):
            if s.get("type") == "start":
                print(lab, dict(s.attrib))
