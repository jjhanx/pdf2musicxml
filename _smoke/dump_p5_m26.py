#!/usr/bin/env python3
import zipfile
import xml.etree.ElementTree as ET

with zipfile.ZipFile("청산에 살리라 F/_inspect_0ea5/review.mxl") as z:
    root = ET.fromstring(z.read([n for n in z.namelist() if n.endswith(".xml")][0]))
p5 = root.find(".//{*}part[@id='P5']")
m26 = p5.find(".//{*}measure[@number='26']")
for c in m26:
    tag = c.tag.split("}")[-1]
    if tag == "attributes":
        print(ET.tostring(c, encoding="unicode"))
for n in m26.findall("{*}note"):
    p = n.find("{*}pitch")
    st = n.find("{*}staff")
    ty = n.find("{*}type")
    vo = n.find("{*}voice")
    dur = n.find("{*}duration")
    if p is None:
        print("rest", ty.text, "dur", dur.text, "st", st.text, "v", vo.text)
    else:
        pitch = p.find("{*}step").text + p.find("{*}octave").text
        dots = len(n.findall("{*}dot"))
        print(pitch, ty.text, "dur", dur.text, "st", st.text, "v", vo.text, "dot", dots)
