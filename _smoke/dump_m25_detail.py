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


def show_part(root, ns, pi, mnum):
    part = root.findall(".//" + q(ns, "part"))[pi]
    print(f"Part {pi+1}")
    for measure in part.findall(q(ns, "measure")):
        if measure.get("number") != mnum:
            continue
        total = 0
        for i, n in enumerate(measure.findall(q(ns, "note"))):
            typ = n.find(q(ns, "type"))
            t = typ.text if typ is not None else "?"
            dur = int(n.find(q(ns, "duration")).text)
            total += dur
            dots = len(n.findall(q(ns, "dot")))
            tm = n.find(q(ns, "time-modification")) is not None
            beams = [b.text for b in n.findall(q(ns, "beam"))]
            p = n.find(q(ns, "pitch"))
            pitch = "rest" if p is None else p.find(q(ns, "step")).text + p.find(q(ns, "octave")).text
            print(
                f"  {i:2d} {pitch} {t}{'.'*dots} d={dur}"
                f"{' T' if tm else ''} beams={beams}"
            )
        print(f"  total={total}")


def main():
    path = sys.argv[1]
    mnum = sys.argv[2] if len(sys.argv) > 2 else "25"
    root, ns = load(path)
    for pi in [0, 1, 4]:
        show_part(root, ns, pi, mnum)
        print()


if __name__ == "__main__":
    main()
