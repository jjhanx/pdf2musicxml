#!/usr/bin/env python3
import io, re, zipfile, xml.etree.ElementTree as ET

z = zipfile.ZipFile("_smoke/omr-work-b3a37755-full/test_fixed.mxl")
c = z.read("META-INF/container.xml").decode()
rf = re.search(r'full-path="([^"]+)"', c).group(1)
root = ET.parse(io.BytesIO(z.read(rf))).getroot()
ns = re.match(r"\{(.*)\}", root.tag).group(1) if re.match(r"\{(.*)\}", root.tag) else ""
q = lambda t: f"{{{ns}}}{t}"

part = [p for p in root.findall(q("part")) if p.get("id") == "P5"][0]
m = part.find(f".//{q('measure')}[@number='28']")
for n in m.findall(q("note")):
    st = n.find(q("staff"))
    if st is not None and st.text != "2":
        continue
    if n.find(q("chord")) is not None:
        continue
    p = n.find(q("pitch"))
    lab = "R" if p is None else p.find(q("step")).text + p.find(q("octave")).text
    typ = n.find(q("type"))
    tm = n.find(q("time-modification"))
    beams = [b.text for b in n.findall(q("beam"))]
    stem = n.find(q("stem"))
    tup = []
    for nt in n.findall(q("notations")):
        t = nt.find(q("tuplet"))
        if t is not None:
            tup.append(t.attrib)
    print(lab, "type", typ.text if typ is not None else "-", "tm", tm is not None, "beams", beams, "stem", stem.text if stem is not None else "-", "tuplet", tup)
