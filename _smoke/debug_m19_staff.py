import io, re, sys, zipfile, xml.etree.ElementTree as ET
import copy
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
    staff = "1"
    groups = fix._staff_chronological_groups(measure, ns, staff)
    g0, g1 = groups[0], groups[1]
    print("g0 dotted?", fix._is_dotted_quarter_group(g0[0], ns, div))
    print("g1 plain quarter?", fix._is_plain_quarter_group(g1[0], ns, div))
    print("staff_total", fix._staff_pitched_duration_sum(measure, ns, staff), "exp", exp)
    print("voices", {g[3] for g in groups if not fix._is_rest(g[0], ns)})
    n = fix._repair_dotted_quarter_on_staff_timeline(measure, ns, div, exp)
    print("fixed", n)
    chrono = fix._staff_chronological_groups(measure, ns, staff)
    for i, g in enumerate(chrono):
        print(f"g{i}", fix._note_type_text(g[0], ns), fix._note_duration(g[0], ns))
