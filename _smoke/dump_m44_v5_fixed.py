#!/usr/bin/env python3
import io, re, zipfile, xml.etree.ElementTree as ET
import sys
mxl = sys.argv[1] if len(sys.argv) > 1 else "_smoke/omr-work-6855d546-full/test_fixed.mxl"
z = zipfile.ZipFile(mxl)
c = z.read("META-INF/container.xml").decode()
rf = re.search(r'full-path="([^"]+)"', c).group(1)
root = ET.parse(io.BytesIO(z.read(rf))).getroot()
ns = re.match(r"\{(.*)\}", root.tag).group(1) if re.match(r"\{(.*)\}", root.tag) else ""
q = lambda t: f"{{{ns}}}{t}"
part = [p for p in root.findall(q("part")) if p.get("id") == "P5"][0]
m = part.find(f".//{q('measure')}[@number='44']")
total = 0
for el in m:
    tag = el.tag.split("}")[-1]
    if tag == "note":
        vo = el.find(q("voice"))
        st = el.find(q("staff"))
        if (vo is None or vo.text != "5") or (st is None or st.text != "2"):
            continue
        ch = el.find(q("chord"))
        if ch is not None:
            continue
        du = el.find(q("duration"))
        d = int(du.text) if du is not None else 0
        total += d
        p = el.find(q("pitch"))
        lab = p.find(q("step")).text + p.find(q("octave")).text if p is not None else "R"
        ty = el.find(q("type"))
        print(lab, ty.text if ty else "?", "dur=", d, "total=", total)
    elif tag == "backup":
        print("backup", el.find(q("duration")).text)
