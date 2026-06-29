#!/usr/bin/env python3
"""fixed MXL 전수 검증: 마디 길이 일치 + 패치 대상 마디 내용 덤프."""
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
def q(t):
    return f"{{{ns}}}{t}" if ns else t

def txt(el):
    return el.text.strip() if el is not None and el.text else None

def pitch(n):
    p = n.find(q("pitch"))
    if p is None:
        return "R" if n.find(q("rest")) is not None else "?"
    s, o = txt(p.find(q("step"))), txt(p.find(q("octave")))
    a = txt(p.find(q("alter")))
    acc = {"1": "#", "-1": "b"}.get(a, "") if a else ""
    return f"{s}{acc}{o}"

print("== 마디 길이 검사 (staff/voice별) ==")
bad = 0
for part in root.findall(q("part")):
    pid = part.get("id")
    divisions = beats = beat_type = None
    for measure in part.findall(q("measure")):
        for attr in measure.findall(q("attributes")):
            d = attr.find(q("divisions"))
            if txt(d):
                divisions = int(txt(d))
            t = attr.find(q("time"))
            if t is not None:
                beats, beat_type = int(txt(t.find(q("beats")))), int(txt(t.find(q("beat-type"))))
        if not divisions or not beats:
            continue
        expected = divisions * beats * 4 // beat_type
        sums = {}
        for n in measure.findall(q("note")):
            if n.find(q("chord")) is not None or n.find(q("grace")) is not None:
                continue
            key = (txt(n.find(q("staff"))) or "1", txt(n.find(q("voice"))) or "1")
            d = txt(n.find(q("duration")))
            sums[key] = sums.get(key, 0) + (int(d) if d else 0)
        for key, total in sums.items():
            if total != expected:
                print(f"  {pid} m{measure.get('number')} staff{key[0]} v{key[1]}: {total}/{expected}")
                bad += 1
print(f"  불일치 {bad}건")

targets = {("18",), ("34",), ("44",), ("56",), ("57",)}
print("\n== 패치 대상 마디 덤프 ==")
for part in root.findall(q("part")):
    pid = part.get("id")
    for measure in part.findall(q("measure")):
        if (measure.get("number"),) not in targets:
            continue
        items = []
        for n in measure.findall(q("note")):
            ch = "+" if n.find(q("chord")) is not None else " "
            dur = txt(n.find(q("duration")))
            typ = txt(n.find(q("type"))) or "?"
            dot = "." if n.find(q("dot")) is not None else ""
            tm = "T" if n.find(q("time-modification")) is not None else ""
            sv = (txt(n.find(q("staff"))) or "1") + "/" + (txt(n.find(q("voice"))) or "1")
            items.append(f"{ch}{pitch(n)}:{typ}{dot}{tm}({dur})[{sv}]")
        print(f"{pid} m{measure.get('number')}: " + " ".join(items))
