import zipfile, re, io, xml.etree.ElementTree as ET
z = zipfile.ZipFile("_smoke/omr-work-e580e133/test.mxl")
c = z.read("META-INF/container.xml").decode()
rf = re.search(r'full-path="([^"]+)"', c).group(1)
root = ET.parse(io.BytesIO(z.read(rf))).getroot()
ns = re.match(r"\{(.*)\}", root.tag).group(1) if root.tag.startswith("{") else ""
def q(t): return f"{{{ns}}}{t}" if ns else t
part = [p for p in root.findall(q("part")) if p.get("id") == "P5"][0]
m = [x for x in part.findall(q("measure")) if x.get("number") == "16"][0]
for note in m.findall(q("note")):
    st = note.find(q("staff"))
    if st is None or st.text != "2":
        continue
    pitch = note.find(q("pitch"))
    lab = "R" if pitch is None else pitch.find(q("step")).text + pitch.find(q("octave")).text
    slurs = []
    for n in note.findall(q("notations")):
        for s in n.findall(q("slur")):
            slurs.append((s.get("type"), s.get("number")))
    if slurs or lab == "A3":
        print(lab, slurs)
