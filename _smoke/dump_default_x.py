#!/usr/bin/env python3
"""Dump default-x and tuplet info for problem measures."""
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET


def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        return ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()


def q(ns, l):
    return f"{{{ns}}}{l}" if ns else l


def dump(path, label, part_idx, mnum, staff):
    root = load(path)
    ns = root.tag.split("}")[0][1:] if root.tag.startswith("{") else ""
    part = root.findall(".//" + q(ns, "part"))[part_idx]
    print(f"\n=== {label} mxl {mnum} staff {staff} ===")
    for measure in part.findall(q(ns, "measure")):
        if measure.get("number") != str(mnum):
            continue
        gi = 0
        cur = []
        for n in measure.findall(q(ns, "note")):
            st = n.find(q(ns, "staff"))
            if st is not None and st.text != staff:
                continue
            if n.find(q(ns, "chord")) is None:
                if cur:
                    gi += 1
                cur = [n]
                leader = n
                x = leader.get("default-x", "?")
                typ = leader.find(q(ns, "type"))
                t = typ.text if typ is not None else "?"
                dur = leader.find(q(ns, "duration")).text
                tm = leader.find(q(ns, "time-modification")) is not None
                notations = leader.find(q(ns, "notations"))
                tup = ""
                if notations is not None:
                    te = notations.find(q(ns, "tuplet"))
                    if te is not None:
                        tup = f" show={te.get('show-number','')} br={te.get('show-bracket','')}"
                print(f" g{gi:2d} x={x:>6} {t} d={dur}{'T' if tm else ''}{tup}")
            else:
                cur.append(n)


if __name__ == "__main__":
    raw = sys.argv[1]
    fixed = sys.argv[2]
    before = sys.argv[3] if len(sys.argv) > 3 else None
    cases = [
        (39, "2", "PL40"),
        (42, "2", "PL43"),
        (47, "2", "PL48"),
        (56, "1", "PR57"),
    ]
    for mnum, staff, name in cases:
        dump(raw, f"RAW {name}", 4, mnum, staff)
        dump(fixed, f"FIX {name}", 4, mnum, staff)
        if before:
            dump(before, f"BEF {name}", 4, mnum, staff)
