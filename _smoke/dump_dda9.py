#!/usr/bin/env python3
import io, re, sys, zipfile
import xml.etree.ElementTree as ET
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

def load(p):
    with zipfile.ZipFile(p) as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        return ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()

def dump(root, tag, part_idx, mxl, staff=None):
    ns = fix.mxl_ns_uri(root)
    part = root.findall(".//" + fix.qname(ns, "part"))[part_idx]
    for measure, div, exp in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != str(mxl):
            continue
        print(f"\n{tag} part{part_idx} mxl{mxl} exp={exp}")
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
            print(f"  v{g[3]} {t:8s} d={d} {p}")

paths = [("_smoke/omr-work-dda9b3f0/audiveris_raw.mxl", "RAW"),
         ("_smoke/dda9_off.mxl", "OFF"),
         ("_smoke/omr-work-dda9b3f0/review.mxl", "REV")]
for mxl, label in [(7, "m8"), (10, "m11"), (15, "m16"), (24, "m25")]:
    print("\n" + "=" * 60, label)
    for part_idx, pname in [(1, "S"), (2, "A"), (3, "T"), (4, "B")]:
        for path, tag in paths:
            dump(load(path), f"{tag}-{pname}", part_idx, mxl)
    for path, tag in paths:
        dump(load(path), f"{tag}-PR", 4, mxl, "1")
        dump(load(path), f"{tag}-PL", 4, mxl, "2")
