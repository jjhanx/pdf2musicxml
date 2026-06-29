import io, re, sys, zipfile, xml.etree.ElementTree as ET
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

def first_x(measure, ns, staff, voice):
    xs = []
    for n in measure.findall(fix.qname(ns, "note")):
        v, s = fix._note_voice_staff(n, ns)
        if s == staff and v == voice and n.find(fix.qname(ns, "chord")) is None:
            x = n.get("default-x")
            if x:
                xs.append(float(x))
    return min(xs) if xs else None

path = "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"
with zipfile.ZipFile(path) as z:
    c = z.read("META-INF/container.xml").decode()
    m = re.search(r'full-path="([^"]+)"', c)
    root = ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()
ns = fix.mxl_ns_uri(root)
part = root.findall(".//" + fix.qname(ns, "part"))[4]
for mnum in ("24", "56"):
    for measure in part.findall(fix.qname(ns, "measure")):
        if measure.get("number") != mnum:
            continue
        print(f"mxl {mnum} staff1 v1={first_x(measure,ns,'1','1')} v2={first_x(measure,ns,'1','2')}")
