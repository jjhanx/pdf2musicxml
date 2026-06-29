#!/usr/bin/env python3
"""첫 화음 chord 멤버별 pitch·accidental 상세."""
import io, re, sys, zipfile, xml.etree.ElementTree as ET

def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        return ET.parse(io.BytesIO(z.read(rf))).getroot()

def q(ns, t):
    return f"{{{ns}}}{t}" if ns else t

def txt(el):
    return el.text.strip() if el is not None and el.text else ""

def midi(n, ns):
    p = n.find(q(ns, "pitch"))
    if p is None:
        return -999
    s = txt(p.find(q(ns, "step")))
    o = int(txt(p.find(q(ns, "octave"))) or "0")
    a = txt(p.find(q(ns, "alter")))
    alter = int(a) if a in ("1", "-1", "2", "-2") else 0
    steps = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
    return (o + 1) * 12 + steps.get(s, 0) + alter

path = sys.argv[1]
measures = sys.argv[2:] if len(sys.argv) > 2 else ["48", "50"]
root = load(path)
m = re.match(r"\{(.*)\}", root.tag)
ns = m.group(1) if m else ""
for part in root.findall(q(ns, "part")):
    if part.get("id") != "P5":
        continue
    for measure in part.findall(q(ns, "measure")):
        mn = measure.get("number")
        if mn not in measures:
            continue
        print(f"\n=== P5 m{mn} staff1 first chord ({path}) ===")
        notes = []
        in_first = True
        for n in measure.findall(q(ns, "note")):
            st = txt(n.find(q(ns, "staff"))) or "1"
            if st != "1":
                continue
            if n.find(q(ns, "chord")) is None and notes:
                break
            if n.find(q(ns, "rest")) is not None:
                break
            p = n.find(q(ns, "pitch"))
            if p is None:
                break
            s = txt(p.find(q(ns, "step")))
            o = txt(p.find(q(ns, "octave")))
            a = txt(p.find(q(ns, "alter")))
            ac = n.find(q(ns, "accidental"))
            acs = ac.text if ac is not None else None
            notes.append((midi(n, ns), f"{s}{'#' if a=='1' else 'b' if a=='-1' else ''}{o}", acs))
        notes.sort(key=lambda x: x[0])
        for i, (_, lab, acs) in enumerate(notes, 1):
            pos = ["bottom", "2nd", "3rd", "4th", "5th"][min(i - 1, 4)]
            if i == len(notes):
                pos = "top" if len(notes) > 1 else "only"
            print(f"  #{i} ({pos}): {lab} accidental={acs}")
