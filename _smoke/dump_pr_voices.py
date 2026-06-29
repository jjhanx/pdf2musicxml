import io, re, sys, zipfile, xml.etree.ElementTree as ET
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

with zipfile.ZipFile("_smoke/omr-work-6855d546-full/audiveris_raw.mxl") as z:
    c = z.read("META-INF/container.xml").decode()
    m = re.search(r'full-path="([^"]+)"', c)
    root = ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()
ns = fix.mxl_ns_uri(root)
part = root.findall(".//" + fix.qname(ns, "part"))[4]
for mnum in ("17", "18", "25", "26", "49"):
    for measure, div, exp in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != mnum:
            continue
        print("=== mxl", mnum)
        for (s, v), groups in fix._voice_groups(measure, ns).items():
            if s != "1":
                continue
            row = []
            for g in groups:
                n = g[0]
                row.append(
                    (
                        "R" if fix._is_rest(n, ns) else "P",
                        fix._note_type_text(n, ns),
                        fix._note_duration(n, ns),
                    )
                )
            print(" v", v, row)
