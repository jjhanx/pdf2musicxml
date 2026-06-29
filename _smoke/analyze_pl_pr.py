import io, re, sys, zipfile, xml.etree.ElementTree as ET
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

for mnum in ("39", "42", "47", "56"):
    path = "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        root = ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()
    ns = fix.mxl_ns_uri(root)
    part = root.findall(".//" + fix.qname(ns, "part"))[4]
    for measure, div, exp in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != mnum:
            continue
        print(f"\n=== mxl {mnum} div={div} exp={exp} ===")
        for (s, v), grps in fix._voice_groups(measure, ns).items():
            if s not in ("1", "2"):
                continue
            total = sum(fix._note_duration(g[0], ns) or 0 for g in grps)
            print(f" staff{s} v{v} n={len(grps)} total={total}")
            for i, g in enumerate(grps):
                n = g[0]
                print(
                    f"  g{i} d={fix._note_duration(n,ns)} tm={n.find(fix.qname(ns,'time-modification')) is not None} "
                    f"x={n.get('default-x')} q={fix._is_plain_quarter_group(n,ns,div)}"
                )
