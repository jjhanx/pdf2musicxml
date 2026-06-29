#!/usr/bin/env python3
import copy
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix


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
        v = n.find(fix.qname(ns, "voice"))
        vv = v.text if v is not None else "?"
        ch = "+" if n.find(fix.qname(ns, "chord")) is not None else " "
        lines.append(f"{ch}{p} dur={d} v={vv}")
    return "\n".join(lines)


if __name__ == "__main__":
    root0, ns = load(sys.argv[1])
    pid, mnum = sys.argv[2], int(sys.argv[3])
    root = copy.deepcopy(root0)
    part = [p for p in root0.findall(fix.qname(ns, "part")) if p.get("id") == pid][0]
    parents = {c: p for p in part.iter() for c in p}
    for measure in part.findall(fix.qname(ns, "measure")):
        if measure.get("number") != str(mnum):
            continue
        fix._clean_measure(measure, ns, parents)
        print("after clean:\n", snap(root, ns, pid, mnum))
        fix._consolidate_cross_voices_on_staff(measure, ns)
        print("after consolidate:\n", snap(root, ns, pid, mnum))
    root = copy.deepcopy(root0)
    part = [p for p in root.findall(fix.qname(ns, "part")) if p.get("id") == pid][0]
    parents = {c: p for p in part.iter() for c in p}
    for measure in part.findall(fix.qname(ns, "measure")):
        fix._clean_measure(measure, ns, parents)
        fix._consolidate_cross_voices_on_staff(measure, ns)
    measure = [x for x in part.findall(fix.qname(ns, "measure")) if x.get("number") == str(mnum)][0]
    _, div, exp = next(
        (m, d, e)
        for m, d, e in fix._iter_measures_with_timing(part, ns)
        if m.get("number") == str(mnum)
    )
    print("div", div, "expected", exp)
    fix._repair_quarter_pair_before_eighths(measure, ns, div or 0, exp or 0)
    print("after quarter_pair:\n", snap(root, ns, pid, mnum))
    fix._repair_dotted_quarter_misread(part, ns)
    print("after dotted:\n", snap(root, ns, pid, mnum))
    fix._repair_overfull_eighth(part, ns)
    print("after overfull:\n", snap(root, ns, pid, mnum))
