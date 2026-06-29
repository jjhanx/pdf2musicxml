#!/usr/bin/env python3
import io, re, zipfile, xml.etree.ElementTree as ET
import sys
sys.path.insert(0, "scripts")
from fix_audiveris_mxl import _voice_groups, _note_duration, qname

def load(p):
    with zipfile.ZipFile(p) as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        root = ET.parse(io.BytesIO(z.read(rf))).getroot()
    ns = re.match(r"\{(.*)\}", root.tag).group(1) if re.match(r"\{(.*)\}", root.tag) else ""
    return root, ns

def div_exp(part, m, ns):
    div = exp = None
    for pm in part.findall(f"{{{ns}}}measure"):
        if int(pm.get("number")) > int(m.get("number")):
            break
        for attr in pm.findall(f"{{{ns}}}attributes"):
            d = attr.find(f"{{{ns}}}divisions")
            if d is not None:
                div = int(d.text)
            ts = attr.find(f"{{{ns}}}time")
            if ts is not None and div:
                b = ts.find(f"{{{ns}}}beats")
                if b is not None:
                    exp = div * int(b.text)
    return div or 12, exp or 48

path = "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"
root, ns = load(path)
part = [p for p in root.findall(f"{{{ns}}}part") if p.get("id") == "P5"][0]
for mn in ("44", "45"):
    m = part.find(f".//{{{ns}}}measure[@number='{mn}']")
    div, exp = div_exp(part, m, ns)
    print(f"\n=== m{mn} div={div} exp={exp} ===")
    for (st, vo), groups in _voice_groups(m, ns).items():
        total = sum(_note_duration(g[0], ns) or 0 for g in groups)
        print(f" staff{st} voice{vo} total={total} (delta={total-exp}) groups={len(groups)}")
        for i, g in enumerate(groups):
            l = g[0]
            dur = _note_duration(l, ns)
            typ = l.find(qname(ns, "type"))
            typ = typ.text if typ is not None else "?"
            beams = [b.text for b in l.findall(qname(ns, "beam"))]
            tm = l.find(qname(ns, "time-modification")) is not None
            print(f"  g{i+1} type={typ} dur={dur} tm={tm} beam={beams}")

# slurs m6
m6 = part.find(f".//{{{ns}}}measure[@number='6']")
print("\n=== m6 slurs in raw ===")
for note in m6.findall(f"{{{ns}}}note"):
    for n in note.findall(f"{{{ns}}}notations"):
        for s in n.findall(f"{{{ns}}}slur"):
            p = note.find(f"{{{ns}}}pitch")
            lab = (p.find(f"{{{ns}}}step").text + p.find(f"{{{ns}}}octave").text) if p is not None else "R"
            print(f"  {lab} slur#{s.get('number')} {s.get('type')} plc={s.get('placement')} dy={s.get('default-y')}")
