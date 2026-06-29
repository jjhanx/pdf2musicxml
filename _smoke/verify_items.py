#!/usr/bin/env python3
"""사용자 보고 항목별 검증: 인쇄 마디 = MXL 마디 + 1 매핑으로 리듬 시퀀스 출력."""
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

path = sys.argv[1]
with zipfile.ZipFile(path) as z:
    container = z.read("META-INF/container.xml").decode("utf-8")
    rootfile = re.search(r'full-path="([^"]+)"', container).group(1)
    data = z.read(rootfile)

root = ET.parse(io.BytesIO(data)).getroot()
m = re.match(r"\{(.*)\}", root.tag)
ns = m.group(1) if m else ""
q = lambda t: f"{{{ns}}}{t}" if ns else t
txt = lambda el: el.text.strip() if el is not None and el.text else None

PART = {"S": ("P1", None), "A": ("P2", None), "T": ("P3", None), "B": ("P4", None),
        "PR": ("P5", "1"), "PL": ("P5", "2")}

# (인쇄 마디, 파트, 설명)
ITEMS = [
    (18, "PR", "#3 2nd 8th"), (19, "S", "#4 2nd 8th + last 8th"), (19, "A", "#5 4th 8th"),
    (19, "T", "#6 2nd 8th + last 8th"), (19, "B", "#7 4th 8th"), (19, "PR", "#8 2nd 8th"),
    (22, "PL", "#10 tie->23"), (24, "T", "#11 1st 8th"), (24, "B", "#11 1st 8th"),
    (24, "PR", "#12 tie->25"), (26, "S", "#13"), (26, "T", "#14"), (26, "B", "#15"),
    (26, "PR", "#16"), (27, "S", "#17"), (27, "B", "#18"), (27, "PR", "#19"),
    (28, "S", "#20"), (28, "T", "#21"), (28, "PR", "#22"), (32, "S", "#23"),
    (32, "T", "#24"), (32, "B", "#25"), (35, "B", "#26/27 2nd 8th + 4th lost"),
    (36, "T", "#28"), (36, "B", "#29"), (42, "S", "#30"), (43, "B", "#31"),
    (45, "T", "#32"), (45, "B", "#33"), (45, "PR", "#34 chords"), (46, "S", "#35"),
    (46, "T", "#36"), (46, "B", "#37"), (47, "S", "#38"), (47, "A", "#39"),
    (47, "T", "#40"), (47, "B", "#41"), (48, "T", "#42"), (48, "B", "#43"),
    (52, "B", "#44"), (54, "S", "#45"), (54, "A", "#46"), (54, "T", "#47"),
    (54, "B", "#48"), (57, "S", "#49"), (57, "T", "#50"), (57, "PR", "#51 overlap"),
    (58, "PR", "#52 C6"), (58, "PL", "#53 C4"), (59, "S", "#54"), (59, "A", "#55"),
    (59, "T", "#56"), (59, "B", "#57"), (61, "PR", "#58 8th note"),
]

def pitch(n):
    p = n.find(q("pitch"))
    if p is None:
        return "R"
    s, o = txt(p.find(q("step"))), txt(p.find(q("octave")))
    a = txt(p.find(q("alter")))
    acc = {"1": "#", "-1": "b"}.get(a, "") if a else ""
    return f"{s}{acc}{o}"

parts = {p.get("id"): p for p in root.findall(q("part"))}
for print_m, pname, desc in ITEMS:
    pid, staff = PART[pname]
    part = parts.get(pid)
    mxl_m = str(print_m - 1)
    target = None
    for measure in part.findall(q("measure")):
        if measure.get("number") == mxl_m:
            target = measure
            break
    if target is None:
        print(f"[{desc}] {print_m}/{pname}: 마디 없음")
        continue
    items = []
    for n in target.findall(q("note")):
        st = txt(n.find(q("staff"))) or "1"
        if staff and st != staff:
            continue
        ch = "+" if n.find(q("chord")) is not None else " "
        typ = txt(n.find(q("type"))) or "?"
        dot = "." if n.find(q("dot")) is not None else ""
        tm = "T" if n.find(q("time-modification")) is not None else ""
        ties = ",".join(t.get("type") for t in n.findall(q("tie")))
        tie_s = f"~{ties}" if ties else ""
        items.append(f"{ch}{pitch(n)}:{typ}{dot}{tm}{tie_s}")
    print(f"[{desc}] {pname} 인쇄{print_m}(m{mxl_m}): " + " ".join(items))
