#!/usr/bin/env python3
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

RAW = "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"
OUT = "_smoke/_m25_step.mxl"

# Run fix and inspect stats by copying fix_mxl_file logic minimally
with zipfile.ZipFile(RAW) as z:
    c = z.read("META-INF/container.xml").decode()
    m = re.search(r'full-path="([^"]+)"', c)
    root = ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()
ns = fix.mxl_ns_uri(root)

part = root.findall(".//" + fix.qname(ns, "part"))[2]
measure = None
for m_el in part.findall(fix.qname(ns, "measure")):
    if m_el.get("number") == "24":
        measure = m_el
        break

def types(m):
    return [fix._note_type_text(g[0], ns) for g in fix._iter_chord_groups(m, ns)]

print("start", types(measure))

# simulate by calling fix_mxl_file on whole file is easier
fix.fix_mxl_file(RAW, OUT)
with zipfile.ZipFile(OUT) as z:
    c = z.read("META-INF/container.xml").decode()
    m = re.search(r'full-path="([^"]+)"', c)
    root2 = ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()
ns2 = fix.mxl_ns_uri(root2)
part2 = root2.findall(".//" + fix.qname(ns2, "part"))[2]
for m_el in part2.findall(fix.qname(ns2, "measure")):
    if m_el.get("number") == "24":
        print("final", [fix._note_type_text(g[0], ns2) for g in fix._iter_chord_groups(m_el, ns2)])
