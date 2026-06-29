#!/usr/bin/env python3
import copy, io, re, sys, zipfile
import xml.etree.ElementTree as ET
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix
import omr_score_patches as patches

z = zipfile.ZipFile("_smoke/omr-work-e580e133/audiveris_raw.mxl")
c = z.read("META-INF/container.xml").decode()
rf = re.search(r'full-path="([^"]+)"', c).group(1)
root = ET.parse(io.BytesIO(z.read(rf))).getroot()
ns = re.match(r"\{(.*)\}", root.tag).group(1)
root = copy.deepcopy(root)
parents = {c: p for p in root.iter() for c in p}
for part in root.findall(fix.qname(ns, "part")):
    for measure in part.findall(fix.qname(ns, "measure")):
        fix._clean_measure(measure, ns, parents)
        fix._consolidate_cross_voices_on_staff(measure, ns)
for part in root.findall(fix.qname(ns, "part")):
    for measure, d, _ in fix._iter_measures_with_timing(part, ns):
        fix._repair_quarter_pair_before_eighths(measure, ns, d or 0)
    fix._repair_overfull_eighth(part, ns)
n = patches.apply_score_patches(root, ns)
print("patches applied", n)
part = [x for x in root.findall(fix.qname(ns, "part")) if x.get("id") == "P5"][0]
m = [x for x in part.findall(fix.qname(ns, "measure")) if x.get("number") == "56"][0]
for note in m.findall(fix.qname(ns, "note")):
    pl = fix._pitch_label(note, ns) or "R"
    v = note.find(fix.qname(ns, "voice")).text
    print(pl, "v" + v)
