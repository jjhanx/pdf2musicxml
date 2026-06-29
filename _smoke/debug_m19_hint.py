import io, re, sys, zipfile, xml.etree.ElementTree as ET
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

with zipfile.ZipFile("_smoke/omr-work-6855d546-full/audiveris_raw.mxl") as z:
    c = z.read("META-INF/container.xml").decode()
    m = re.search(r'full-path="([^"]+)"', c)
    root = ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()
ns = fix.mxl_ns_uri(root)
part = root.findall(".//" + fix.qname(ns, "part"))[4]
for measure, div, exp in fix._iter_measures_with_timing(part, ns):
    if measure.get("number") != "18":
        continue
    print("hint", fix._staff_has_dotted_quarter_eighth_voice(measure, ns, "1", div, skip_voice="1"))
    print("hint skip2", fix._staff_has_dotted_quarter_eighth_voice(measure, ns, "1", div, skip_voice="2"))
    n = fix._repair_dotted_quarter_on_staff_timeline(measure, ns, div, exp)
    print("fixed", n)
