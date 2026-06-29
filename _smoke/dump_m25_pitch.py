#!/usr/bin/env python3
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

RAW = "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"

with zipfile.ZipFile(RAW) as z:
    c = z.read("META-INF/container.xml").decode()
    m = re.search(r'full-path="([^"]+)"', c)
    root = ET.fromstring(z.read(m.group(1)))
ns = fix.mxl_ns_uri(root)

def pitch_str(note, ns):
    p = note.find(fix.qname(ns, "pitch"))
    if p is None:
        return "rest"
    step = p.find(fix.qname(ns, "step"))
    octv = p.find(fix.qname(ns, "octave"))
    alt = p.find(fix.qname(ns, "alter"))
    s = step.text if step is not None else "?"
    o = octv.text if octv is not None else "?"
    a = alt.text if alt is not None else ""
    return f"{s}{a}/{o}"

for pi, name in [(2, "T"), (3, "B"), (4, "PR")]:
    part = root.findall(".//" + fix.qname(ns, "part"))[pi]
    for measure in part.findall(fix.qname(ns, "measure")):
        if measure.get("number") != "24":
            continue
        print(f"\n=== {name} ===")
        for note in measure.findall(fix.qname(ns, "note")):
            if note.find(fix.qname(ns, "chord")) is not None:
                continue
            v = note.find(fix.qname(ns, "voice"))
            vt = v.text if v is not None else "?"
            if pi == 4 and vt != "1":
                continue
            typ = note.find(fix.qname(ns, "type"))
            print(
                "v" + vt,
                typ.text if typ is not None else "?",
                pitch_str(note, ns),
                "x=" + str(note.get("default-x")),
            )
