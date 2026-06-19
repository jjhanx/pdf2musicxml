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

    # 4 PR m25 (mxl 24) — v1 앞 빔 8분 2개, v2 5번째 4분 유지
    m = get_measure(root, ns, 4, 24)
    v1 = [g for g in fix._iter_chord_groups(m, ns) if g[2] == "1" and g[3] == "1"]
    v2 = [g for g in fix._iter_chord_groups(m, ns) if g[2] == "1" and g[3] == "2"]
    if not (
        leader_type(v1[0][1], ns) == "eighth"
        and leader_type(v1[1][1], ns) == "eighth"
        and v1[0][0].findall(fix.qname(ns, "beam"))
        and v1[1][0].findall(fix.qname(ns, "beam"))
    ):
        fails.append("PR m25: v1 opening should be beamed eighths")
    if leader_type(v2[2][1], ns) != "quarter":
        fails.append("PR m25: v2 3rd group (5th on staff) should stay quarter")

    # 4b T/B m25 — 𝄽8 + 첫 8분(4분 오인) + … , 4번째 4분 유지
    for part_idx, label in [(2, "T m25"), (3, "B m25")]:
        m = get_measure(root, ns, part_idx, 24)
        g = [x for x in fix._iter_chord_groups(m, ns)]
        if not fix._is_rest(g[0][0], ns):
            fails.append(f"{label}: 1st should be eighth rest")
        if leader_type(g[0][1], ns) != "eighth":
            fails.append(f"{label}: 1st should be eighth rest type")
        if leader_type(g[1][1], ns) != "eighth":
            fails.append(f"{label}: 2nd (1st pitched) should be eighth not quarter")
        if leader_type(g[4][1], ns) != "quarter":
            fails.append(f"{label}: 4th quarter should stay quarter")

    # 5-6 PR m26,m27 2nd chord eighth
    for mnum, label in [(25, "PR m26"), (26, "PR m27")]:
        m = get_measure(root, ns, 4, mnum)
        g = groups(m, ns, "1")
        if leader_type(g[1], ns) != "eighth":
            fails.append(f"{label}: 2nd chord should be eighth")

    # 7-8 PL m40,m43 — 1st triplet + 3rd/4th triplet groups
    for mnum, label in [(39, "PL m40"), (42, "PL m43")]:
        m = get_measure(root, ns, 4, mnum)
        g = groups(m, ns, "2")
        if g[0][0].find(fix.qname(ns, "time-modification")) is None:
            fails.append(f"{label}: 1st triplet missing time-modification")
        notations = g[0][0].find(fix.qname(ns, "notations"))
        if notations is None or notations.find(fix.qname(ns, "tuplet")) is None:
            fails.append(f"{label}: 1st triplet missing tuplet number")
        xs = [float(n.get("default-x", 9999)) for grp in (g[5], g[6]) for n in grp]
        if xs != sorted(xs):
            fails.append(f"{label}: 3rd/4th triplet notes overlap (default-x)")

    # 9-10 T/B m45 no slur g2-g3
    for part_idx, label in [(2, "T m45"), (3, "B m45")]:
        m = get_measure(root, ns, part_idx, 44)
        g = groups(m, ns)
        if has_slur_between(g[2], g[3], ns):
            fails.append(f"{label}: spurious slur between 3rd and 4th notes")

    # 11 PL m48 — no stray quarter; 7~8th eighth chords separate
    m = get_measure(root, ns, 4, 47)
    g = groups(m, ns, "2")
    if any(leader_type(grp, ns) == "quarter" for grp in g):
        fails.append("PL m48: quarter chord remains (7-8th eighths collapsed)")
    eighth_idxs = [i for i, grp in enumerate(g) if leader_type(grp, ns) == "eighth"]
    if len(eighth_idxs) < 2 or leader_dur(g[eighth_idxs[-2]], ns) != leader_dur(g[eighth_idxs[-1]], ns):
        fails.append("PL m48: trailing eighth chords missing")

    # 12 PR m50 2nd chord eighth
    m = get_measure(root, ns, 4, 49)
    g = groups(m, ns, "1")
    if leader_type(g[1], ns) != "eighth":
        fails.append("PR m50: 2nd chord should be eighth")

    # 13 PR m57 — 2nd note eighth + default-x chronological order
    m = get_measure(root, ns, 4, 56)
    g = groups(m, ns, "1")
    if leader_type(g[1], ns) != "eighth":
        fails.append("PR m57: 2nd note should be eighth not quarter")
    xs = [float(grp[0].get("default-x", 9999)) for grp in g]
    if xs != sorted(xs):
        fails.append("PR m57: notes out of default-x order (overlap)")

    # 14-16 m19 (mxl 18) — 점4분 뒤 8분/4분 오인, 쉼표 순서·음고
    for part_idx, label, expect in [
        (1, "S m19", ["quarter", "eighth", "eighth", "eighth", "quarter"]),
        (2, "A m19", ["quarter", "quarter", "eighth", "quarter"]),
        (3, "T m19", ["half", "eighth", "eighth", "quarter"]),
    ]:
        m = get_measure(root, ns, part_idx, 18)
        g = groups(m, ns)
        types = [leader_type(grp, ns) for grp in g[: len(expect)]]
        if types != expect:
            fails.append(f"{label}: rhythm {types} != {expect}")
        if label == "S m19" and leader_type(g[2], ns) == "quarter":
            fails.append("S m19: 3rd note should be eighth not quarter")
        if label == "A m19":
            if leader_type(g[2], ns) != "eighth" or not fix._is_rest(g[3][0], ns):
                fails.append("A m19: 4th note eighth + quarter rest")
            elif leader_type(g[3], ns) != "quarter":
                fails.append("A m19: trailing rest should be quarter not eighth")

    # 17 m45 PR (mxl 44) — beamed 8th pair must stay eighths
    m = get_measure(root, ns, 4, 44)
    g = groups(m, ns, "1")
    if not (
        leader_type(g[2], ns) == "eighth"
        and leader_type(g[3], ns) == "eighth"
        and g[2][0].findall(fix.qname(ns, "beam"))
        and g[3][0].findall(fix.qname(ns, "beam"))
    ):
        fails.append("PR m45: 3rd-4th beamed eighth pair corrupted")

    # 18 m45 PL (mxl 44 staff2) — 8 groups, no triplet span expansion
    m = get_measure(root, ns, 4, 44)
    g = groups(m, ns, "2")
    if len(g) != 8:
        fails.append(f"PL m45: expected 8 chord groups, got {len(g)}")

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
