#!/usr/bin/env python3
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
import fix_audiveris_mxl as f

z = zipfile.ZipFile("_smoke/omr-work-2e86a8e0/audiveris_raw.mxl")
c = z.read("META-INF/container.xml").decode()
rf = re.search(r'full-path="([^"]+)"', c).group(1)
root = ET.parse(io.BytesIO(z.read(rf))).getroot()
m = re.match(r"\{(.*)\}", root.tag)
ns = m.group(1) if m else ""
part = [p for p in root.findall(f.qname(ns, "part")) if p.get("id") == "P5"][0]
for measure, div, exp in f._iter_measures_with_timing(part, ns):
    if measure.get("number") != "47":
        continue
    for (st, v), grps in f._voice_groups(measure, ns).items():
        if st != "1" or v != "1":
            continue
        total = sum(f._note_duration(g[0], ns) or 0 for g in grps)
        _, bd = f._voice_backup_after_notes(measure, ns, st, v)
        other = f._other_staff_same_voice_duration_before_backup(
            measure, ns, st, v, grps[1][0]
        )
        print("total", total, "backup", bd, "other", other, "sum", total + other)
        eighth = div // 2
        print("pattern E len2", len(grps) == 2, "match", bd == total + other)

import copy
part2 = copy.deepcopy(part)
fixed, _ = f._repair_dotted_quarter_misread(part2, ns)
print("repair fixed count", fixed)
for measure in part2.findall(f.qname(ns, "measure")):
    if measure.get("number") != "47":
        continue
    for n in measure.findall(f.qname(ns, "note")):
        st = n.find(f.qname(ns, "staff"))
        if st is not None and st.text == "1" and n.find(f.qname(ns, "chord")) is None:
            print(" ", f._pitch_label(n, ns), f._note_duration(n, ns), f._note_type_text(n, ns))
