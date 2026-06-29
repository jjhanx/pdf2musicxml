import io, re, sys, zipfile, xml.etree.ElementTree as ET
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

for mnum in ("17", "18"):
    with zipfile.ZipFile("_smoke/omr-work-6855d546-full/audiveris_raw.mxl") as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        root = ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()
    ns = fix.mxl_ns_uri(root)
    part = root.findall(".//" + fix.qname(ns, "part"))[4]
    for measure, div, exp in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != mnum:
            continue
        print("=== mxl", mnum, "div", div, "exp", exp)
        groups = fix._staff_chronological_groups(measure, ns, "1")
        for i, g in enumerate(groups):
            print(f"  g{i} v{g[3]}", fix._note_duration(g[0], ns))
        print("  sum", fix._staff_pitched_duration_sum(measure, ns, "1"))
