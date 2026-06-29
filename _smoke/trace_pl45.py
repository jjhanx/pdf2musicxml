#!/usr/bin/env python3
import copy, io, re, sys, zipfile
import xml.etree.ElementTree as ET
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

RAW = "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"
with zipfile.ZipFile(RAW) as z:
    rb = z.read(re.search(r'full-path="([^"]+)"', z.read("META-INF/container.xml").decode()).group(1))

def show_rb(root_bytes, pi, mnum, staff="2"):
    root = ET.fromstring(root_bytes)
    ns = fix.mxl_ns_uri(root)
    part = root.findall(".//" + fix.qname(ns, "part"))[pi]
    for measure, _, _ in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != mnum:
            continue
        out = []
        for g in fix._iter_chord_groups(measure, ns):
            if g[2] != staff:
                continue
            n = g[0]
            t = fix._note_type_text(n, ns)
            if fix._is_rest(n, ns):
                t = "R-" + t
            tm = n.find(fix.qname(ns, "time-modification")) is not None
            b = bool(n.findall(fix.qname(ns, "beam")))
            out.append(t + ("T" if tm else "") + ("*" if b else ""))
        return out

out, stats = fix.fix_score_xml(rb)
print("PL m44", show_rb(out, 4, "44", "2"))
print("stats swap", stats.get("quarter_pair_eighth_fixed"))
print("triplet", stats.get("quarter_chord_triplet_expanded"))
print("three8", stats.get("three_eighth_triplet_fixed"))
