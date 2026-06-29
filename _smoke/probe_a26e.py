#!/usr/bin/env python3
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

def pitch(n, ns):
    p = n.find(q(ns, "pitch"))
    if p is None:
        return "R"
    s, o = txt(p.find(q(ns, "step"))), txt(p.find(q(ns, "octave")))
    a = txt(p.find(q(ns, "alter")))
    acc = {"1": "#", "-1": "b"}.get(a, "") if a else ""
    return f"{s}{acc}{o}"

def chord_pitches(notes, ns):
    out = []
    for n in notes:
        p = n.find(q(ns, "pitch"))
        if p is not None:
            out.append(pitch(n, ns))
    return tuple(out)

def slurs(n, ns):
    return [(s.get("number"), s.get("type"), s.get("placement"), s.get("orientation")) for s in n.findall(".//"+q(ns,"slur"))]

def dump_measure(measure, ns, staff_filter=None):
    mn = measure.get("number")
    print(f"\n=== m{mn} ===")
    chord = []
    gi = 0
    for n in measure.findall(q(ns, "note")):
        st = txt(n.find(q(ns, "staff"))) or "1"
        if staff_filter and st != staff_filter:
            continue
        is_ch = n.find(q(ns, "chord")) is not None
        if not is_ch:
            if chord:
                gi += 1
                print_group(gi, chord, ns)
                chord = []
            gi += 1
            chord = [n]
        else:
            chord.append(n)
    if chord:
        gi += 1
        print_group(gi, chord, ns)

def print_group(gi, notes, ns):
    leader = notes[0]
    st = txt(leader.find(q(ns, "staff"))) or "1"
    pitches = chord_pitches(notes, ns)
    typ = txt(leader.find(q(ns, "type")))
    tm = "T" if leader.find(q(ns, "time-modification")) is not None else ""
    stem = txt(leader.find(q(ns, "stem"))) or "-"
    bm = ",".join(b.text or "?" for b in leader.findall(q(ns, "beam")))
    sl = slurs(leader, ns)
    for n in notes[1:]:
        sl += slurs(n, ns)
    print(f" g{gi} s{st} {pitches} {typ}{tm} stem={stem} beam={bm or '-'} slur={sl or '-'}")

path = sys.argv[1]
root = load(path)
ns = re.match(r"\{(.*)\}", root.tag).group(1) if re.match(r"\{(.*)\}", root.tag) else ""
targets = {"6", "30", "41", "42", "43", "44", "45"}
for part in root.findall(q(ns, "part")):
    if part.get("id") != "P5":
        continue
    for measure in part.findall(q(ns, "measure")):
        if measure.get("number") not in targets:
            continue
        dump_measure(measure, ns)
