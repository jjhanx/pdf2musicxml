#!/usr/bin/env python3
"""Scan user-reported 2nd-eighth->quarter cases in raw OMR."""
import io, re, sys, zipfile
import xml.etree.ElementTree as ET
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

RAW = "_smoke/omr-work-10373611/audiveris_raw.mxl"

# (printed, label, part_idx, staff)
CASES = [
    (8,"S",1,None),(11,"S",1,None),(12,"S",1,None),(16,"B",4,None),
    (19,"S",1,None),(19,"T",3,None),(19,"A",2,None),(19,"B",4,None),
    (22,"B",4,None),(25,"T",3,None),(25,"B",4,None),
    (26,"S",1,None),(26,"T",3,None),(26,"B",4,None),(26,"PR",4,"1"),
    (27,"S",1,None),(27,"B",4,None),(27,"PR",4,"1"),
    (28,"S",1,None),(28,"T",3,None),(28,"PR",4,"1"),
    (32,"S",1,None),(32,"T",3,None),(32,"B",4,None),
    (36,"T",3,None),(36,"B",4,None),(42,"S",1,None),(43,"B",4,None),
    (45,"T",3,None),(45,"B",4,None),
    (46,"S",1,None),(46,"T",3,None),(46,"B",4,None),
    (47,"S",1,None),(47,"A",2,None),(47,"T",3,None),(47,"B",4,None),
    (48,"T",3,None),(48,"B",4,None),(48,"PR",4,"1"),
    (52,"B",4,None),(57,"S",1,None),(57,"T",3,None),(57,"PR",4,"1"),
    (59,"S",1,None),(59,"A",2,None),(59,"T",3,None),(59,"B",4,None),
    (61,"PR",4,"1"),
]

def load(p):
    with zipfile.ZipFile(p) as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        return ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()

root = load(RAW)
ns = fix.mxl_ns_uri(root)

print("printed  part  #2type  #2dur  pitch/rest  (user: 8th->quarter?)")
for pm, label, pidx, staff in CASES:
    mxl = pm - 1
    part = root.findall(".//" + fix.qname(ns, "part"))[pidx]
    for measure, div, exp in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != str(mxl):
            continue
        rows = []
        for g in fix._iter_chord_groups(measure, ns):
            if staff and g[2] != staff:
                continue
            n = g[0]
            t = fix._note_type_text(n, ns) or "?"
            d = fix._note_duration(n, ns)
            if fix._is_rest(n, ns):
                p = "R-" + t
            else:
                p = "+".join(sorted(fix._pitch_label(x, ns) or "?" for x in g[1]))
            rows.append((t, d, p))
        if len(rows) < 2:
            print(f"m{pm:2d} {label:3s}  <{len(rows)} notes>")
            continue
        t, d, p = rows[1]
        flag = "QUARTER-in-RAW" if t == "quarter" and not p.startswith("R-") else "eighth-ok" if t == "eighth" else t
        print(f"m{pm:2d} {label:3s}  {t:8s} d={d:2d}  {p:20s}  {flag}")
