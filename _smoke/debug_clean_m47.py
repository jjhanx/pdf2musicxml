#!/usr/bin/env python3
import copy
import io
import re
import zipfile
import xml.etree.ElementTree as ET

import sys

sys.path.insert(0, "scripts")
import fix_audiveris_mxl as f

z = zipfile.ZipFile("_smoke/omr-work-2e86a8e0/audiveris_raw.mxl")
c = z.read("META-INF/container.xml").decode()
rf = re.search(r'full-path="([^"]+)"', c).group(1)
root = ET.parse(io.BytesIO(z.read(rf))).getroot()
m = re.match(r"\{(.*)\}", root.tag)
ns = m.group(1) if m else ""
part = [p for p in root.findall(f.qname(ns, "part")) if p.get("id") == "P5"][0]
parents = {c: p for p in part.iter() for c in p}
for measure in part.findall(f.qname(ns, "measure")):
    f._clean_measure(measure, ns, parents)
    f._consolidate_cross_voices_on_staff(measure, ns)
fixed, _ = f._repair_dotted_quarter_misread(part, ns)
print("fixed", fixed)
for measure in part.findall(f.qname(ns, "measure")):
    if measure.get("number") != "47":
        continue
    for (st, v), grps in f._voice_groups(measure, ns).items():
        if v == "1":
            print("voice key", repr(st), repr(v), "n", len(grps))
    for n in measure.findall(f.qname(ns, "note")):
        st = n.find(f.qname(ns, "staff"))
        vo = n.find(f.qname(ns, "voice"))
        if (
            st is not None
            and st.text == "1"
            and vo is not None
            and vo.text == "1"
            and n.find(f.qname(ns, "chord")) is None
        ):
            print(" ", f._pitch_label(n, ns), f._note_duration(n, ns))
