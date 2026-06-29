#!/usr/bin/env python3
import io, re, sys, zipfile
import xml.etree.ElementTree as ET
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

RAW = "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"
with zipfile.ZipFile(RAW) as z:
    rb = z.read(re.search(r'full-path="([^"]+)"', z.read("META-INF/container.xml").decode()).group(1))

def tail_rests(rb, mnum):
    root = ET.fromstring(rb)
    ns = fix.mxl_ns_uri(root)
    for pi in range(5):
        part = root.findall(".//" + fix.qname(ns, "part"))[pi]
        for measure, _, _ in fix._iter_measures_with_timing(part, ns):
            if measure.get("number") != mnum:
                continue
            groups = list(fix._iter_chord_groups(measure, ns))
            if not groups:
                continue
            last = groups[-1]
            if fix._is_rest(last[0], ns):
                print(f"P{pi+1} m{mnum} END {fix._note_type_text(last[0],ns)} rest v{last[3]}")

print("RAW")
for m in ["24", "41", "44"]:
    tail_rests(rb, m)
out, _ = fix.fix_score_xml(rb)
print("\nFIXED")
for m in ["24", "41", "44"]:
    tail_rests(out, m)
