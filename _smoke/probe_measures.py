#!/usr/bin/env python3
"""특정 part/measure 덤프. Args: mxl part mxl_measure [staff]"""
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

path, part_id, mnum = sys.argv[1], sys.argv[2], sys.argv[3]
staff_filter = sys.argv[4] if len(sys.argv) > 4 else None

with zipfile.ZipFile(path) as z:
    container = z.read("META-INF/container.xml").decode("utf-8")
    rootfile = re.search(r'full-path="([^"]+)"', container).group(1)
    data = z.read(rootfile)

root = ET.parse(io.BytesIO(data)).getroot()
m = re.match(r"\{(.*)\}", root.tag)
ns = m.group(1) if m else ""
q = lambda t: f"{{{ns}}}{t}" if ns else t
txt = lambda el: el.text.strip() if el is not None and el.text else None


def pitch(n):
    p = n.find(q("pitch"))
    if p is None:
        return "R"
    s, o = txt(p.find(q("step"))), txt(p.find(q("octave")))
    a = txt(p.find(q("alter")))
    acc = {"1": "#", "-1": "b", "sharp": "#", "flat": "b"}.get(a, "") if a else ""
    acc_el = n.find(q("accidental"))
    if acc_el is not None and acc_el.text:
        acc = f"({acc_el.text})"
    return f"{s}{acc}{o}"


for part in root.findall(q("part")):
    if part.get("id") != part_id:
        continue
    for measure in part.findall(q("measure")):
        if measure.get("number") != mnum:
            continue
        print(f"=== {part_id} m{measure.get('number')} ===")
        for el in measure:
            tag = el.tag.split("}")[-1]
            if tag in ("backup", "forward"):
                print(f"  {tag.upper()} {txt(el.find(q('duration')))}")
                continue
            if tag != "note":
                if tag == "direction":
                    kinds = []
                    for dt in el.findall(q("direction-type")):
                        for c in dt:
                            lt = c.tag.split("}")[-1]
                            if lt == "dynamics":
                                kinds.append("dyn:" + ",".join(x.tag.split("}")[-1] for x in c))
                            elif lt == "words":
                                kinds.append(f"words:{(c.text or '').strip()!r}")
                            else:
                                kinds.append(lt)
                    if kinds:
                        print(f"  DIR {kinds} plc={el.get('placement')}")
                continue
            st = txt(el.find(q("staff"))) or "1"
            if staff_filter and st != staff_filter:
                continue
            ch = "+" if el.find(q("chord")) is not None else " "
            typ = txt(el.find(q("type"))) or "?"
            dot = "." if el.find(q("dot")) is not None else ""
            tm = "T" if el.find(q("time-modification")) is not None else ""
            stem = txt(el.find(q("stem"))) or ""
            beams = [txt(b) for b in el.findall(q("beam"))]
            arts = []
            for nt in el.findall(q("notations")):
                for t in nt.findall(q("tuplet")):
                    arts.append(f"tuplet:{t.get('type')} show={t.get('show-number')} plc={t.get('placement')}")
                for a in nt.findall(q("articulations")):
                    for x in a:
                        arts.append(f"{x.tag.split('}')[-1]}:{x.get('placement')}")
            sv = f"s{st}/v{txt(el.find(q('voice'))) or '1'}"
            print(
                f"  {ch}{pitch(el)} {typ}{dot}{tm} dur={txt(el.find(q('duration')))} "
                f"stem={stem} beam={beams} [{sv}] {' '.join(arts)}"
            )
