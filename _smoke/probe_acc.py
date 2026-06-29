#!/usr/bin/env python3
"""Compare accidentals in raw vs fixed for given part/measure."""
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET


def load_mxl(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        root = ET.parse(io.BytesIO(z.read(rf))).getroot()
    m = re.match(r"\{(.*)\}", root.tag)
    ns = m.group(1) if m else ""
    return root, ns


def pitch(n, q):
    p = n.find(q("pitch"))
    if p is None:
        return "R"
    s = (p.find(q("step")).text or "").strip()
    o = (p.find(q("octave")).text or "").strip()
    a = p.find(q("alter"))
    alt = ""
    if a is not None and a.text:
        try:
            v = int(float(a.text))
            alt = "#" if v == 1 else ("b" if v == -1 else "")
        except ValueError:
            pass
    acc = n.find(q("accidental"))
    acc_t = f"({acc.text})" if acc is not None and acc.text else ""
    return f"{s}{alt}{o}{acc_t}"


def dump(path, pid, mnum, staff=None):
    root, ns = load_mxl(path)
    q = lambda t: f"{{{ns}}}{t}" if ns else t
    print(f"\n--- {path} P{pid} m{mnum} ---")
    for part in root.findall(q("part")):
        if part.get("id") != pid:
            continue
        for measure in part.findall(q("measure")):
            if measure.get("number") != str(mnum):
                continue
            i = 0
            for el in measure:
                tag = el.tag.split("}")[-1]
                if tag == "note":
                    st = el.find(q("staff"))
                    stv = st.text if st is not None else "1"
                    if staff and stv != staff:
                        continue
                    ch = "+" if el.find(q("chord")) is not None else " "
                    i += 1 if ch == " " else 0
                    arts = []
                    for nt in el.findall(q("notations")):
                        for a in nt.findall(q("articulations")):
                            for x in a:
                                arts.append(x.tag.split("}")[-1])
                        if nt.find(q("fermata")) is not None:
                            arts.append("fermata")
                        for t in nt.findall(q("tied")):
                            arts.append(f"tie:{t.get('type')}")
                        for s in nt.findall(q("slur")):
                            arts.append(f"slur:{s.get('type')}")
                    print(f" {ch}{i}: {pitch(el, q)} {arts}")


if __name__ == "__main__":
    raw = sys.argv[1]
    fixed = sys.argv[2]
    pid, mnum = sys.argv[3], sys.argv[4]
    staff = sys.argv[5] if len(sys.argv) > 5 else None
    dump(raw, pid, mnum, staff)
    dump(fixed, pid, mnum, staff)
