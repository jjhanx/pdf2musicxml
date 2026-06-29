#!/usr/bin/env python3
import copy
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

RAW = "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"

with zipfile.ZipFile(RAW) as z:
    root_bytes = z.read(re.search(r'full-path="([^"]+)"', z.read("META-INF/container.xml").decode()).group(1))

root = ET.fromstring(root_bytes)
ns = fix.mxl_ns_uri(root)


def t24(part_idx, staff=None):
    part = root.findall(".//" + fix.qname(ns, "part"))[part_idx]
    for measure, _, _ in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != "24":
            continue
        out = []
        for g in fix._iter_chord_groups(measure, ns):
            if staff and g[2] != staff:
                continue
            n = g[0]
            t = fix._note_type_text(n, ns)
            if fix._is_rest(n, ns):
                t = "R-" + t
            b = any(n.findall(fix.qname(ns, "beam")))
            out.append(t + ("*" if b else ""))
        return out


# Monkey-patch key functions to log
orig_halve = fix._halve_group_to_eighth
orig_set_q = fix._set_group_to_quarter
orig_split = fix._split_quarter_chord_to_beamed_eighth_pair

def log_halve(notes, ns):
    print("  HALVE", fix._note_type_text(notes[0], ns))
    return orig_halve(notes, ns)

def log_set_q(notes, ns, div):
    print("  SET_QUARTER", fix._note_type_text(notes[0], ns))
    return orig_set_q(notes, ns, div)

fix._halve_group_to_eighth = log_halve
fix._set_group_to_quarter = log_set_q

out, stats = fix.fix_score_xml(root_bytes)
root2 = ET.fromstring(out)
ns2 = fix.mxl_ns_uri(root2)

print("T before", t24(2))
print("PR v1 before", end=" ")
part = ET.fromstring(root_bytes)
ns0 = fix.mxl_ns_uri(part)
p = part.findall(".//" + fix.qname(ns0, "part"))[4]
for measure, _, _ in fix._iter_measures_with_timing(p, ns0):
    if measure.get("number") == "24":
        for g in fix._iter_chord_groups(measure, ns0):
            if g[2] == "1" and g[3] == "1":
                print(fix._note_type_text(g[0], ns0), end=" ")
print()

print("\n--- running fix ---")
out, stats = fix.fix_score_xml(root_bytes)
root2 = ET.fromstring(out)
ns2 = fix.mxl_ns_uri(root2)

def t24b(pi, staff=None, voice=None):
    part = root2.findall(".//" + fix.qname(ns2, "part"))[pi]
    for measure, _, _ in fix._iter_measures_with_timing(part, ns2):
        if measure.get("number") != "24":
            continue
        out = []
        for g in fix._iter_chord_groups(measure, ns2):
            if staff and g[2] != staff:
                continue
            if voice and g[3] != voice:
                continue
            n = g[0]
            t = fix._note_type_text(n, ns2)
            if fix._is_rest(n, ns2):
                t = "R-" + t
            b = any(n.findall(fix.qname(ns2, "beam")))
            out.append(t + ("*" if b else ""))
        return out

print("T after", t24b(2))
print("PR v1 after", t24b(4, staff="1", voice="1"))
print("stats quarter_pair", stats.get("quarter_pair_eighth_fixed"))
print("stats overfull", stats.get("overfull_eighth_fixed"))
