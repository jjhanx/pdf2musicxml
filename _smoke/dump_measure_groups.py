#!/usr/bin/env python3
"""Dump measure rhythm by staff for regression compare."""
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
    tup_num = ""
    if tm:
        for d in measure_directions:
            pass
    beams = [b.text for b in leader.findall(q(ns, "beam"))]
    slurs = []
    for sn in leader.findall(q(ns, "notations")):
        for sl in sn.findall(q(ns, "slur")):
            slurs.append(sl.get("type", "?"))
    pitches = "+".join(pitch(x, ns) for x in grp)
    show_t = leader.find(".//" + q(ns, "tuplet"))
    tup_show = show_t.get("show-number") if show_t is not None else ""
    return f"{pitches} {t}{'.'*dots} d={dur}{'T' if tm else ''} b={beams} sl={slurs} tn={tup_show}"


def dump(part_idx, mxl_mnum, staff=None, label=""):
    root, ns = load(mxl)
    part = root.findall(".//" + q(ns, "part"))[part_idx]
    print(f"\n{label} Part{part_idx+1} m{mxl_mnum} staff={staff or 'all'}")
    for measure in part.findall(q(ns, "measure")):
        if measure.get("number") != str(mxl_mnum):
            continue
        grps = group_notes(measure, ns, staff)
        for i, g in enumerate(grps):
            print(f"  g{i:2d} {fmt_group(g, ns)}")


if __name__ == "__main__":
    mxl = sys.argv[1]
    part_idx = int(sys.argv[2])
    mnum = sys.argv[3]
    staff = sys.argv[4] if len(sys.argv) > 4 else None
    dump(part_idx, mnum, staff, mxl)
