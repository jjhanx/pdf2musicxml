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
    if measure.get("number") != "47":
        continue
    for (s, v), grps in fix._voice_groups(measure, ns).items():
        if s != "2" or v != "5":
            continue
        for i, g in enumerate(grps):
            n = g[0]
            beams = [b.text for b in n.findall(fix.qname(ns, "beam"))]
            print(i, fix._note_duration(n,ns), beams, fix._is_plain_quarter_group(n,ns,div))
