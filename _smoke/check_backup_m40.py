import io, re, sys, zipfile, xml.etree.ElementTree as ET
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

path = "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"
with zipfile.ZipFile(path) as z:
    c = z.read("META-INF/container.xml").decode()
    m = re.search(r'full-path="([^"]+)"', c)
    root = ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()
ns = fix.mxl_ns_uri(root)
part = root.findall(".//" + fix.qname(ns, "part"))[4]
for measure, div, exp in fix._iter_measures_with_timing(part, ns):
    if measure.get("number") != "39":
        continue
    for el in measure:
        tag = fix.local_tag(el)
        if tag in ("backup", "forward"):
            print(tag, el.find(fix.qname(ns, "duration")).text if el.find(fix.qname(ns, "duration")) is not None else "?")
