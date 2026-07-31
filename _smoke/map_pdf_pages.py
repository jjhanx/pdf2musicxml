import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

def local(t):
    return t.split("}", 1)[-1] if "}" in t else t

mxl = Path("청산에 살리라 F/_inspect_0ea5/review.mxl")
with zipfile.ZipFile(mxl) as z:
    xml_name = [n for n in z.namelist() if n.endswith(".xml") and "META" not in n][0]
    root = ET.fromstring(z.read(xml_name))
part = root.find('.//{*}part[@id="P1"]')
page = 1
starts = {1: 1}
for meas in part:
    if local(meas.tag) != "measure":
        continue
    n = int(meas.get("number") or 0)
    for pr in meas.findall(".//{*}print"):
        if pr.get("new-page") == "yes":
            page += 1
            starts[page] = n
            print(f"PDF page {page} starts XML m{n}")
print("page starts", starts)
