import xml.etree.ElementTree as ET

root = ET.parse("_smoke/20e5_score.xml").getroot()
p5 = root.find('.//{*}part[@id="P5"]')
for m in p5.findall("{*}measure")[:3]:
    print("measure", m.get("number"))
    for a in m.findall("{*}attributes"):
        for c in a:
            tag = c.tag.split("}")[-1]
            if tag in ("staves", "clef", "divisions", "key"):
                print(" ", ET.tostring(c, encoding="unicode").strip()[:140])

# voices in m17 all parts
for pid in ("P1", "P2", "P5"):
    part = root.find(f'.//{{*}}part[@id="{pid}"]')
    m = next(x for x in part.findall("{*}measure") if x.get("number") == "17")
    voices = set()
    for n in m.findall("{*}note"):
        v = n.find("{*}voice")
        if v is not None and v.text:
            voices.add(v.text.strip())
    dirs = []
    for d in m.findall("{*}direction"):
        st = d.find("{*}staff")
        vo = d.find("{*}voice")
        w = d.find(".//{*}words")
        dirs.append((st.text if st is not None else None, vo.text if vo is not None else None, w.text if w is not None else ""))
    print(f"{pid} m17 voices={sorted(voices)} dirs={dirs}")
