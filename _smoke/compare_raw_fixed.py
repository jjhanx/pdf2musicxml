#!/usr/bin/env python3
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET


def load(mxl):
    with zipfile.ZipFile(mxl) as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        root = ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()
    ns = root.tag.split("}")[0][1:] if root.tag.startswith("{") else ""
    return root, ns


def q(ns, l):
    return f"{{{ns}}}{l}" if ns else l


def pitch(n, ns):
    p = n.find(q(ns, "pitch"))
    if p is None:
        return "rest"
    s = p.find(q(ns, "step")).text
    o = p.find(q(ns, "octave")).text
    a = p.find(q(ns, "alter"))
    alt = "" if a is None else ("#" if int(a.text) > 0 else "b")
    return s + alt + o


def group_notes(measure, ns, staff=None):
    groups = []
    cur = []
    for n in measure.findall(q(ns, "note")):
        st_el = n.find(q(ns, "staff"))
        st = st_el.text if st_el is not None else "1"
        if staff and st != staff:
            continue
        if n.find(q(ns, "chord")) is None:
            if cur:
                groups.append(cur)
            cur = [n]
        else:
            cur.append(n)
    if cur:
        groups.append(cur)
    return groups


def fmt_group(grp, ns):
    leader = grp[0]
    typ = leader.find(q(ns, "type"))
    t = typ.text if typ is not None else "?"
    dur = leader.find(q(ns, "duration")).text
    dots = len(leader.findall(q(ns, "dot")))
    tm = leader.find(q(ns, "time-modification")) is not None
    beams = [b.text for b in leader.findall(q(ns, "beam"))]
    slurs = []
    notations = leader.find(q(ns, "notations"))
    if notations is not None:
        for sl in notations.findall(q(ns, "slur")):
            slurs.append(sl.get("type", "?"))
    pitches = "+".join(pitch(x, ns) for x in grp)
    tup_show = ""
    if notations is not None:
        tup = notations.find(q(ns, "tuplet"))
        if tup is not None:
            tup_show = tup.get("show-number", "")
    return f"{pitches} {t}{'.'*dots} d={dur}{'T' if tm else ''} b={beams} sl={slurs} tup={tup_show}"


def dump_mxl(path, part_idx, mnum, staff=None):
    root, ns = load(path)
    part = root.findall(".//" + q(ns, "part"))[part_idx]
    lines = []
    for measure in part.findall(q(ns, "measure")):
        if measure.get("number") != str(mnum):
            continue
        grps = group_notes(measure, ns, staff)
        for i, g in enumerate(grps):
            lines.append(f"g{i:2d} {fmt_group(g, ns)}")
    return lines


def main():
    cases = [
        ("PL m16", 4, "15", "2"),
        ("PR m18", 4, "17", "1"),
        ("PR m19", 4, "18", "1"),
        ("PR m25", 4, "24", "1"),
        ("PR m26", 4, "25", "1"),
        ("PR m27", 4, "26", "1"),
        ("PL m40", 4, "39", "2"),
        ("PL m43", 4, "42", "2"),
        ("T m45", 2, "44", None),
        ("B m45", 3, "44", None),
        ("PL m48", 4, "47", "2"),
        ("PR m50", 4, "49", "1"),
        ("PR m57", 4, "56", "1"),
    ]
    raw = sys.argv[1]
    cur = sys.argv[2]
    for label, pi, m, st in cases:
        r = dump_mxl(raw, pi, m, st)
        c = dump_mxl(cur, pi, m, st)
        if r == c:
            continue
        print(f"\n=== {label} (mxl {m}) DIFF ===")
        print("RAW:")
        for x in r:
            print(" ", x)
        print("FIXED:")
        for x in c:
            print(" ", x)


if __name__ == "__main__":
    main()
