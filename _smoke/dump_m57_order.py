import io, re, sys, zipfile, xml.etree.ElementTree as ET
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

for label, path in [("RAW", "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"), ("FIX", "_smoke/reg_check.mxl"), ("BEF", "_smoke/reg_before_m25fix.mxl")]:
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        root = ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()
    ns = fix.mxl_ns_uri(root)
    part = root.findall(".//" + fix.qname(ns, "part"))[4]
    for measure in part.findall(fix.qname(ns, "measure")):
        if measure.get("number") != "56":
            continue
        print(f"\n{label} children:")
        for el in measure:
            tag = fix.local_tag(el)
            if tag == "note":
                v = el.find(fix.qname(ns, "voice"))
                x = el.get("default-x", "?")
                chord = el.find(fix.qname(ns, "chord")) is not None
                print(f"  note v={v.text if v is not None else '?'} x={x} chord={chord}")
            elif tag in ("backup", "forward"):
                print(f"  {tag} dur={el.find(fix.qname(ns,'duration')).text}")
