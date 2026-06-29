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

def slur_info(n, ns):
    out = []
    for s in n.findall(".//" + q(ns, "slur")):
        out.append(f"{s.get('number')}:{s.get('type')} plc={s.get('placement')}")
    return out

path = sys.argv[1]
root = load(path)
m = re.match(r"\{(.*)\}", root.tag)
ns = m.group(1) if m else ""
targets = {"6", "30", "44"}
for part in root.findall(q(ns, "part")):
    if part.get("id") != "P5":
        continue
    for measure in part.findall(q(ns, "measure")):
        mn = measure.get("number")
        if mn not in targets:
            continue
        print(f"\n=== P5 m{mn} ({path}) ===")
        for n in measure.findall(q(ns, "note")):
            st = txt(n.find(q(ns, "staff"))) or "1"
            if mn in {"44"} and st != "2":
                continue
            if mn not in {"44"} and st != "1":
                continue
            ch = "+" if n.find(q(ns, "chord")) is not None else " "
            typ = txt(n.find(q(ns, "type")))
            dur = txt(n.find(q(ns, "duration")))
            tm = "T" if n.find(q(ns, "time-modification")) is not None else ""
            stem = txt(n.find(q(ns, "stem")))
            bm = ",".join(b.text or "?" for b in n.findall(q(ns, "beam")))
            sl = slur_info(n, ns)
            tup = ""
            for notations in n.findall(q(ns, "notations")):
                t = notations.find(q(ns, "tuplet"))
                if t is not None and t.get("type") == "start":
                    tup = f" tup br={t.get('bracket')} sb={t.get('show-bracket')}"
            extra = f" stem={stem}" if stem else ""
            if bm:
                extra += f" beam={bm}"
            if sl:
                extra += f" slur={sl}"
            print(f" {ch}{pitch(n, ns)}:{typ}{tm}({dur}){tup}{extra}")
