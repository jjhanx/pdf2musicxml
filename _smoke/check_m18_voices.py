import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

with zipfile.ZipFile("_smoke/omr-work-6855d546-full/audiveris_raw.mxl") as z:
    c = z.read("META-INF/container.xml").decode()
    m = re.search(r'full-path="([^"]+)"', c)
    root = ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()
ns = fix.mxl_ns_uri(root)
part = root.findall(".//" + fix.qname(ns, "part"))[4]
for measure, div, exp in fix._iter_measures_with_timing(part, ns):
    if measure.get("number") != "17":
        continue
    for (s, v), grps in fix._voice_groups(measure, ns).items():
        if s != "1":
            continue
        print("v", v, [(fix._note_type_text(g[0], ns), fix._note_duration(g[0], ns)) for g in grps])
    chrono = fix._staff_chronological_groups(measure, ns, "1")
    print("chrono voices", {g[3] for g in chrono})
    print("staff sum", fix._staff_pitched_duration_sum(measure, ns, "1"))
