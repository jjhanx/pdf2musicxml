#!/usr/bin/env python3
import io, re, zipfile, xml.etree.ElementTree as ET

def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        return ET.parse(io.BytesIO(z.read(rf))).getroot()

def q(ns, t):
    return f"{{{ns}}}{t}" if ns else t

for label, path in [("RAW", "_smoke/omr-work-a26ecec0-full/audiveris_raw.mxl"), ("FIX", "_smoke/omr-work-a26ecec0-full/test_fixed.mxl")]:
    root = load(path)
    ns = re.match(r"\{(.*)\}", root.tag).group(1) if re.match(r"\{(.*)\}", root.tag) else ""
    part = [p for p in root.findall(q(ns, "part")) if p.get("id") == "P5"][0]
    print(f"\n==== {label} ====")
    for mn in ("41","42","43","44","45"):
        m = part.find(f".//{q(ns,'measure')}[@number='{mn}']")
        chord = []
        gi = 0
        groups = []
        for n in m.findall(q(ns, "note")):
            st = (n.find(q(ns,"staff")).text if n.find(q(ns,"staff")) is not None else "1")
            if st != "1":
                continue
            ch = n.find(q(ns,"chord")) is not None
            if not ch:
                if chord:
                    groups.append(chord)
                chord = [n]
            else:
                chord.append(n)
        if chord:
            groups.append(chord)
        print(f"m{mn} ({len(groups)} groups):", end="")
        for i, g in enumerate(groups[:7]):
            l = g[0]
            pitches = []
            for x in g:
                p = x.find(q(ns,"pitch"))
                if p is not None:
                    pitches.append(p.find(q(ns,"step")).text + p.find(q(ns,"octave")).text)
            typ = l.find(q(ns,"type")).text
            dur = l.find(q(ns,"duration")).text
            beams = [b.text for b in l.findall(q(ns,"beam"))]
            print(f" g{i+1}={pitches}/{typ}/{dur}/beam={beams}", end="")
        print()
