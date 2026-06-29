#!/usr/bin/env python3
import io, re, sys, zipfile, xml.etree.ElementTree as ET

mxl = sys.argv[1] if len(sys.argv) > 1 else "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"
z = zipfile.ZipFile(mxl)
c = z.read("META-INF/container.xml").decode()
rf = re.search(r'full-path="([^"]+)"', c).group(1)
root = ET.parse(io.BytesIO(z.read(rf))).getroot()
ns = re.match(r"\{(.*)\}", root.tag).group(1) if re.match(r"\{(.*)\}", root.tag) else ""
q = lambda t: f"{{{ns}}}{t}"
part = [p for p in root.findall(q("part")) if p.get("id") == "P5"][0]
for mno in ["6", "30"]:
    m = part.find(f".//{q('measure')}[@number='{mno}']")
    print(f"=== printed ~{int(mno)+1} XML m{mno}")
    grp = []
    chord = []
    for n in m.findall(q("note")):
        st = n.find(q("staff"))
        if st is not None and st.text != "1":
            continue
        ch = n.find(q("chord")) is not None
        if not ch:
            if chord:
                grp.append(chord)
            chord = [n]
        else:
            chord.append(n)
    if chord:
        grp.append(chord)
    for i, g in enumerate(grp):
        p = g[0].find(q("pitch"))
        lab = p.find(q("step")).text + p.find(q("octave")).text if p is not None else "R"
        stem = g[0].find(q("stem"))
        st = stem.text if stem is not None else "?"
        pitches = []
        for n in g:
            p2 = n.find(q("pitch"))
            if p2 is not None:
                pitches.append(p2.find(q("step")).text + p2.find(q("octave")).text)
        slurs = []
        for n in g:
            p2 = n.find(q("pitch"))
            plab = p2.find(q("step")).text + p2.find(q("octave")).text if p2 is not None else "?"
            for s in n.findall(".//" + q("slur")):
                slurs.append((plab, dict(s.attrib)))
        print(f" g{i+1} {pitches} stem={st} slurs={slurs}")
