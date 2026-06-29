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


def note_info(n, ns):
    typ = n.find(q(ns, "type"))
    t = typ.text if typ is not None else "?"
    dur = n.find(q(ns, "duration"))
    d = dur.text if dur is not None else "?"
    dots = sum(1 for _ in n.findall(q(ns, "dot")))
    ch = "+" if n.find(q(ns, "chord")) is not None else ""
    v = n.find(q(ns, "voice"))
    voice = v.text if v is not None else "?"
    st = n.find(q(ns, "staff"))
    staff = st.text if st is not None else "?"
    tup = n.find(".//" + q(ns, "time-modification"))
    tm = ""
    if tup is not None:
        a = tup.find(q(ns, "actual-notes"))
        n2 = tup.find(q(ns, "normal-notes"))
        tm = f" T{a.text}/{n2.text}" if a is not None else " T"
    dot_s = "." * dots
    return f"s{staff} v{voice} {pitch(n, ns)}{ch} {t}{dot_s} d={d}{tm}"


def dump_part_measure(root, ns, pi, mnum):
    parts = root.findall(".//" + q(ns, "part"))
    part = parts[pi]
    sp = part.find(q(ns, "score-part"))
    name = sp.get("id") if sp is not None else str(pi + 1)
    for measure in part.findall(q(ns, "measure")):
        if measure.get("number") != str(mnum):
            continue
        print(f"=== Part {pi + 1} ({name}) m{mnum} ===")
        for i, n in enumerate(measure.findall(q(ns, "note"))):
            print(f"  {i:2d} {note_info(n, ns)}")


def main():
    mnum = sys.argv[1] if len(sys.argv) > 1 else "25"
    paths = sys.argv[2:] or [
        "_smoke/omr-work-6855d546-full/audiveris_raw.mxl",
        "_smoke/omr-work-6855d546-full/test_fixed.mxl",
    ]
    for path in paths:
        print("\n####", path)
        root, ns = load(path)
        for pi in range(5):
            dump_part_measure(root, ns, pi, mnum)


if __name__ == "__main__":
    main()
