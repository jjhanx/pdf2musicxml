#!/usr/bin/env python3
"""두 MXL의 마디별 음표수 차이 + 추가된 음 표시."""
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET


def load(path):
    with zipfile.ZipFile(path) as z:
        container = z.read("META-INF/container.xml").decode("utf-8")
        rootfile = re.search(r'full-path="([^"]+)"', container).group(1)
        return ET.parse(io.BytesIO(z.read(rootfile))).getroot()


def q(ns, t):
    return f"{{{ns}}}{t}" if ns else t


def txt(el):
    return el.text.strip() if el is not None and el.text else None


def pitches(measure, ns):
    out = []
    for n in measure.findall(q(ns, "note")):
        p = n.find(q(ns, "pitch"))
        if p is None:
            out.append("R")
            continue
        s, o = txt(p.find(q(ns, "step"))), txt(p.find(q(ns, "octave")))
        out.append(f"{s}{o}")
    return out


a_root, b_root = load(sys.argv[1]), load(sys.argv[2])
m = re.match(r"\{(.*)\}", a_root.tag)
ns = m.group(1) if m else ""
for pa, pb in zip(a_root.findall(q(ns, "part")), b_root.findall(q(ns, "part"))):
    for ma, mb in zip(pa.findall(q(ns, "measure")), pb.findall(q(ns, "measure"))):
        la, lb = pitches(ma, ns), pitches(mb, ns)
        if la != lb:
            extra = list(lb)
            for x in la:
                if x in extra:
                    extra.remove(x)
            print(f"{pa.get('id')} m{ma.get('number')}: +{extra} ({len(la)}->{len(lb)})")
