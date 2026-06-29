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
part = root.findall(".//" + fix.qname(ns, "part"))[2]
for measure in part.findall(fix.qname(ns, "measure")):
    if measure.get("number") != "24":
        continue
    for note in measure.findall(fix.qname(ns, "note")):
        dur = note.find(fix.qname(ns, "duration"))
        typ = note.find(fix.qname(ns, "type"))
        voice = note.find(fix.qname(ns, "voice"))
        chord = note.find(fix.qname(ns, "chord"))
        rest = note.find(fix.qname(ns, "rest"))
        print(
            "dur",
            dur.text if dur is not None else "?",
            "type",
            typ.text if typ is not None else "?",
            "v",
            voice.text if voice is not None else "?",
            "chord" if chord is not None else "",
            "rest" if rest is not None else "",
            "x",
            note.get("default-x"),
        )
