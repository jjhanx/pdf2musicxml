#!/usr/bin/env python3
import io, re, sys, zipfile, xml.etree.ElementTree as ET

def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        return ET.parse(io.BytesIO(z.read(rf))).getroot()

def q(ns, t):
    return f"{{{ns}}}{t}" if ns else t

def dump_staff(path, mn, staff):
    root = load(path)
    ns = re.match(r"\{(.*)\}", root.tag).group(1) if re.match(r"\{(.*)\}", root.tag) else ""
    part = [p for p in root.findall(q(ns, "part")) if p.get("id") == "P5"][0]
    measure = part.find(f".//{q(ns,'measure')}[@number='{mn}']")
    print(f"\n{path} m{mn} staff{staff}")
    chord = []
    gi = 0
    for n in measure.findall(q(ns, "note")):
        st = (n.find(q(ns, "staff")).text if n.find(q(ns, "staff")) is not None else "1")
        if st != staff:
            continue
        ch = n.find(q(ns, "chord")) is not None
        if not ch:
            if chord:
                gi += 1
                show(gi, chord, ns)
                chord = []
            chord = [n]
        else:
            chord.append(n)
    if chord:
        gi += 1
        show(gi, chord, ns)

def show(gi, notes, ns):
    def pl(n):
        p = n.find(q(ns, "pitch"))
        if p is None:
            return "R"
        a = p.find(q(ns, "alter"))
        acc = {"1": "#", "-1": "b"}.get((a.text if a is not None else ""), "")
        return p.find(q(ns, "step")).text + acc + p.find(q(ns, "octave")).text
    leader = notes[0]
    typ = leader.find(q(ns, "type")).text
    tm = leader.find(q(ns, "time-modification")) is not None
    stem = leader.find(q(ns, "stem"))
    stem = stem.text if stem is not None else "-"
    beams = [b.text for b in leader.findall(q(ns, "beam"))]
    sl = []
    for n in notes:
        for s in n.findall(".//" + q(ns, "slur")):
            sl.append(dict(s.attrib))
    print(f" g{gi} {[pl(n) for n in notes]} {typ}{'T' if tm else ''} stem={stem} beam={beams} slur={sl}")

path = sys.argv[1]
for mn in sys.argv[2].split(","):
    for st in ("1", "2"):
        dump_staff(path, mn, st)
