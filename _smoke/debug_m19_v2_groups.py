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
    for (s, v), groups in fix._voice_groups(measure, ns).items():
        if v != "2":
            continue
        for i, g in enumerate(groups):
            n = g[0]
            print(i, "rest", fix._is_rest(n, ns), "type", fix._note_type_text(n, ns), "dur", fix._note_duration(n, ns))
            print("  pitch", n.find(fix.qname(ns, "pitch")) is not None, "rest el", n.find(fix.qname(ns, "rest")) is not None)
