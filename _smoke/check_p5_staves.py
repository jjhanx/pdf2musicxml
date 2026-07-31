import io, zipfile, xml.etree.ElementTree as ET
from pathlib import Path

ZIP = Path(__file__).resolve().parents[1] / "omr-work-20e53bc4.zip"
with zipfile.ZipFile(ZIP) as z:
    inner = zipfile.ZipFile(io.BytesIO(z.read("review.mxl")))
    xml = inner.read([n for n in inner.namelist() if n.endswith(".xml")][0])
root = ET.fromstring(xml)
print("score-parts:")
for sp in root.findall(".//{*}score-part"):
    pid = sp.get("id")
    pn = sp.find("{*}part-name")
    print(" ", pid, pn.text if pn is not None else "")
p5 = root.find('.//{*}part[@id="P5"]')
max_st = 1
for m in p5.findall("{*}measure")[:5]:
    for st in m.findall(".//{*}staves"):
        if st.text:
            max_st = max(max_st, int(st.text))
    for st in m.findall(".//{*}note/{*}staff"):
        if st.text:
            max_st = max(max_st, int(st.text))
print("P5 max staves (first 5 measures):", max_st)
