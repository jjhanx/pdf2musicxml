#!/usr/bin/env python3
import io, re, zipfile, sys
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix
import xml.etree.ElementTree as ET


def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        return ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()


def dump(path, pi, label):
    root = load(path)
    ns = fix.mxl_ns_uri(root)
    part = root.findall(".//" + fix.qname(ns, "part"))[pi]
    for measure, div, exp in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != "18":
            continue
        parts = []
        for g in fix._iter_chord_groups(measure, ns):
            n = g[0]
            t = fix._note_type_text(n, ns)
            p = "R-" + t if fix._is_rest(n, ns) else (fix._pitch_label(n, ns) or "?")
            parts.append(f"{t}:{p}")
        print(f"  {label}: {' | '.join(parts)}")


RAW = "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"
FIX = "_smoke/reg_check.mxl"
print("RAW")
for pi, lb in [(1, "S"), (2, "A"), (3, "T"), (4, "B")]:
    dump(RAW, pi, lb)
print("FIX")
for pi, lb in [(1, "S"), (2, "A"), (3, "T"), (4, "B")]:
    dump(FIX, pi, lb)
