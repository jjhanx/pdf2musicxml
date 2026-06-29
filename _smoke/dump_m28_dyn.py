#!/usr/bin/env python3
import io, re, zipfile, xml.etree.ElementTree as ET

z = zipfile.ZipFile("_smoke/omr-work-2ffe8bd0-full/audiveris_raw.mxl")
c = z.read("META-INF/container.xml").decode()
rf = re.search(r'full-path="([^"]+)"', c).group(1)
root = ET.parse(io.BytesIO(z.read(rf))).getroot()
m = re.match(r"\{(.*)\}", root.tag)
ns = m.group(1) if m else ""
q = lambda t: f"{{{ns}}}{t}" if ns else t
part = [p for p in root.findall(q("part")) if p.get("id") == "P5"][0]
measure = part.find(f".//{q('measure')}[@number='28']")
for d in measure.findall(q("direction")):
    staff_el = d.find(q("staff"))
    st = staff_el.text if staff_el is not None else "?"
    for dt in d.findall(q("direction-type")):
        dyn = dt.find(q("dynamics"))
        if dyn is not None:
            print("staff", st, "dyn", "".join(dyn.itertext()), ET.tostring(dyn, encoding="unicode")[:120])
