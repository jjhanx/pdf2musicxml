#!/usr/bin/env python3
import io, re, zipfile, xml.etree.ElementTree as ET

z = zipfile.ZipFile("_smoke/omr-work-6855d546-full/audiveris_raw.mxl")
c = z.read("META-INF/container.xml").decode()
rf = re.search(r'full-path="([^"]+)"', c).group(1)
root = ET.parse(io.BytesIO(z.read(rf))).getroot()
ns = re.match(r"\{(.*)\}", root.tag).group(1) if re.match(r"\{(.*)\}", root.tag) else ""
q = lambda t: f"{{{ns}}}{t}"
part = [p for p in root.findall(q("part")) if p.get("id") == "P5"][0]
m = part.find(f".//{q('measure')}[@number='44']")
for el in m:
    tag = el.tag.split("}")[-1]
    if tag in ("attributes", "barline", "print"):
        print(tag, el.attrib)
    elif tag == "note":
        st = el.find(q("staff"))
        vo = el.find(q("voice"))
        du = el.find(q("duration"))
        ty = el.find(q("type"))
        ch = el.find(q("chord"))
        p = el.find(q("pitch"))
        lab = ""
        if p is not None:
            lab = p.find(q("step")).text + p.find(q("octave")).text
        print(f"note v={vo.text if vo is not None else '?'} s={st.text if st is not None else '?'} {lab} {ty.text if ty is not None else '?'} dur={du.text if du is not None else '?'} chord={ch is not None}")
    elif tag in ("backup", "forward"):
        du = el.find(q("duration"))
        print(tag, du.text if du is not None else "")
