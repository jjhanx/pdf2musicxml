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
    print("div", div, "exp", exp)
    for (s, v), grps in fix._voice_groups(measure, ns).items():
        if s != "2":
            continue
        total = sum(fix._note_duration(g[0], ns) or 0 for g in grps)
        print("voice", v, "groups", len(grps), "total", total)
        for i, g in enumerate(grps):
            n = g[0]
            print(
                f"  g{i} x={n.get('default-x')} d={fix._note_duration(n,ns)} "
                f"tm={n.find(fix.qname(ns,'time-modification')) is not None} "
                f"typ={fix._note_type_text(n,ns)}"
            )
