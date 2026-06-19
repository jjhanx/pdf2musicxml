#!/usr/bin/env python3
"""Verify 13 reported regression cases after fix_audiveris_mxl."""
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix


def load_mxl(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        return ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()


def groups(measure, ns, staff=None):
    out = []
    cur = []
    for n in measure.findall(fix.qname(ns, "note")):
        st_el = n.find(fix.qname(ns, "staff"))
        st = st_el.text if st_el is not None else "1"
        if staff and st != staff:
            continue
        if n.find(fix.qname(ns, "chord")) is None:
            if cur:
                out.append(cur)
            cur = [n]
        else:
            cur.append(n)
    if cur:
        out.append(cur)
    return out


def leader_type(grp, ns):
    t = grp[0].find(fix.qname(ns, "type"))
    return t.text if t is not None else "?"


def leader_dur(grp, ns):
    d = grp[0].find(fix.qname(ns, "duration"))
    return int(d.text) if d is not None and d.text else 0


def has_slur_between(g0, g1, ns):
    for n in g0:
        for notations in n.findall(fix.qname(ns, "notations")):
            for sl in notations.findall(fix.qname(ns, "slur")):
                if sl.get("type") == "stop":
                    return True
    for n in g1:
        for notations in n.findall(fix.qname(ns, "notations")):
            for sl in notations.findall(fix.qname(ns, "slur")):
                if sl.get("type") == "start":
                    return True
    return False


def get_measure(root, ns, part_idx, mnum):
    part = root.findall(".//" + fix.qname(ns, "part"))[part_idx]
    for measure in part.findall(fix.qname(ns, "measure")):
        if measure.get("number") == str(mnum):
            return measure
    return None


def run_checks(path):
    root = load_mxl(path)
    ns = fix.mxl_ns_uri(root)
    fails = []

    # 1 PL m16 — 3rd triplet run (g6–8) must stay plain eighths, not tripletized into g9
    m = get_measure(root, ns, 4, 15)
    g = groups(m, ns, "2")
    for idx in (6, 7, 8):
        if g[idx][0].find(fix.qname(ns, "time-modification")) is not None:
            fails.append("PL m16: 3rd triplet run wrongly tripletized (overlap with 4th)")

    # 2-3 PR m18,m19 2nd chord eighth
    for mnum, label in [(17, "PR m18"), (18, "PR m19")]:
        m = get_measure(root, ns, 4, mnum)
        g = groups(m, ns, "1")
        if leader_type(g[1], ns) != "eighth":
            fails.append(f"{label}: 2nd chord should be eighth")

    # 4 PR m25 first two beamed eighths
    m = get_measure(root, ns, 4, 24)
    g = groups(m, ns, "1")
    if not (leader_type(g[0], ns) == "eighth" and leader_type(g[1], ns) == "eighth"):
        fails.append("PR m25: first two chords should be beamed eighths")

    # 5-6 PR m26,m27 2nd chord eighth
    for mnum, label in [(25, "PR m26"), (26, "PR m27")]:
        m = get_measure(root, ns, 4, mnum)
        g = groups(m, ns, "1")
        if leader_type(g[1], ns) != "eighth":
            fails.append(f"{label}: 2nd chord should be eighth")

    # 7-8 PL m40,m43 triplet groups distinct (d=4T not collapsed)
    for mnum, label in [(39, "PL m40"), (42, "PL m43")]:
        m = get_measure(root, ns, 4, mnum)
        g = groups(m, ns, "2")
        if leader_dur(g[6], ns) != leader_dur(g[7], ns) or leader_dur(g[6], ns) == 0:
            fails.append(f"{label}: triplet notes overlap")
        tm6 = g[6][0].find(fix.qname(ns, "time-modification")) is not None
        if not tm6:
            fails.append(f"{label}: 3rd triplet missing time-modification")

    # 9-10 T/B m45 no slur g2-g3
    for part_idx, label in [(2, "T m45"), (3, "B m45")]:
        m = get_measure(root, ns, part_idx, 44)
        g = groups(m, ns)
        if has_slur_between(g[2], g[3], ns):
            fails.append(f"{label}: spurious slur between 3rd and 4th notes")

    # 11 PL m48 g8,g9 separate eighth chords (7th/8th notes)
    m = get_measure(root, ns, 4, 47)
    g = groups(m, ns, "2")
    if not (leader_type(g[8], ns) == "eighth" and leader_type(g[9], ns) == "eighth"):
        fails.append("PL m48: 7-8th eighth chords collapsed")

    # 12 PR m50 2nd chord eighth
    m = get_measure(root, ns, 4, 49)
    g = groups(m, ns, "1")
    if leader_type(g[1], ns) != "eighth":
        fails.append("PR m50: 2nd chord should be eighth")

    # 13 PR m57 g1,g2 not overlapping
    m = get_measure(root, ns, 4, 56)
    g = groups(m, ns, "1")
    if leader_type(g[1], ns) != "eighth":
        fails.append("PR m57: 2nd note should be eighth not quarter")

    return fails


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "_smoke/reg_current_fix.mxl"
    fails = run_checks(path)
    if fails:
        print("FAIL:")
        for f in fails:
            print(" ", f)
        sys.exit(1)
    print("All 13 checks passed on", path)
