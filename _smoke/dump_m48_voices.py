import io, re, sys, zipfile, xml.etree.ElementTree as ET
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix


def dump(path, label):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        root = ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()
    ns = fix.mxl_ns_uri(root)
    part = root.findall(".//" + fix.qname(ns, "part"))[4]
    for measure in part.findall(fix.qname(ns, "measure")):
        if measure.get("number") != "47":
            continue
        print(label)
        for n in measure.findall(fix.qname(ns, "note")):
            if n.find(fix.qname(ns, "chord")) is not None:
                continue
            st_el = n.find(fix.qname(ns, "staff"))
            s = st_el.text if st_el is not None and st_el.text else "1"
            if s != "2":
                continue
            v_el = n.find(fix.qname(ns, "voice"))
            v = v_el.text if v_el is not None and v_el.text else "?"
            print(
                " v", v,
                "x", n.get("default-x"),
                "d", fix._note_duration(n, ns),
                "t", fix._note_type_text(n, ns),
            )


dump("_smoke/omr-work-6855d546-full/audiveris_raw.mxl", "RAW")
dump("_smoke/reg_check.mxl", "FIX")
dump("_smoke/reg_before_m25fix.mxl", "BEF")
