#!/usr/bin/env python3
import copy
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix
import omr_score_patches as patches


def load(path):
    z = zipfile.ZipFile(path)
    c = z.read("META-INF/container.xml").decode()
    rf = re.search(r'full-path="([^"]+)"', c).group(1)
    root = ET.parse(io.BytesIO(z.read(rf))).getroot()
    m = re.match(r"\{(.*)\}", root.tag)
    return root, m.group(1) if m else ""


def snap(root, ns, pid, mnum):
    part = [p for p in root.findall(fix.qname(ns, "part")) if p.get("id") == pid][0]
    m = [x for x in part.findall(fix.qname(ns, "measure")) if x.get("number") == str(mnum)][0]
    lines = []
    for n in m.findall(fix.qname(ns, "note")):
        p = fix._pitch_label(n, ns) or "R"
        d = fix._note_duration(n, ns)
        t = fix._note_type_text(n, ns)
        ch = "+" if n.find(fix.qname(ns, "chord")) is not None else " "
        lines.append(f"{ch}{p} {t} dur={d}")
    return "\n".join(lines)


def apply_steps(root, ns, stop):
    root = copy.deepcopy(root)
    for part in root.findall(fix.qname(ns, "part")):
        parents = {c: p for p in part.iter() for c in p}
        for measure in part.findall(fix.qname(ns, "measure")):
            fix._clean_measure(measure, ns, parents)
            fix._consolidate_cross_voices_on_staff(measure, ns)
    if stop == "clean":
        return root
    for part in root.findall(fix.qname(ns, "part")):
        max_staff = fix._max_staff_in_part(part, ns)
        for measure, divisions, expected in fix._iter_measures_with_timing(part, ns):
            fix._dedupe_chord_members_in_measure(measure, ns)
            fix._repair_quarter_pair_before_eighths(measure, ns, divisions or 0)
            fix._repair_two_quarter_voice_as_eighths(measure, ns, divisions or 0, expected or 0)
            fix._repair_three_eighths_as_triplet(measure, ns, max_staff, divisions or 0)
        for measure in part.findall(fix.qname(ns, "measure")):
            fix._repair_two_quarters_as_triplet_prefix(measure, ns, max_staff)
        fix._repair_dotted_quarter_misread(part, ns)
        fix._repair_overfull_eighth(part, ns)
    if stop == "rhythm":
        return root
    patches.apply_score_patches(root, ns)
    if stop == "patches":
        return root
    for part in root.findall(fix.qname(ns, "part")):
        max_staff = fix._max_staff_in_part(part, ns)
        fix._ensure_tuplet_notations(part, ns, max_staff)
        for note in part.iter(fix.qname(ns, "note")):
            fix._fix_tuplet_show_numbers(note, ns, max_staff)
    return root


if __name__ == "__main__":
    path = sys.argv[1]
    pid = sys.argv[2]
    mnum = int(sys.argv[3])
    root0, ns = load(path)
    prev = snap(root0, ns, pid, mnum)
    print("RAW:\n", prev, sep="")
    for step in ("clean", "rhythm", "patches", "done"):
        r = apply_steps(root0, ns, step)
        cur = snap(r, ns, pid, mnum)
        if cur != prev:
            print(f"\n--- after {step} ---\n{cur}")
            prev = cur
