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
        if s != "1":
            continue
        g0, g1 = groups[0][0], groups[1][0]
        g1 = groups[1][0]
        print(
            "v",
            v,
            "g1 type",
            fix._note_type_text(g1, ns),
            "dur",
            fix._note_duration(g1, ns),
            "plain",
            fix._is_plain_eighth_group(g1, ns, div),
        )
