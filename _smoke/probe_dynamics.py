#!/usr/bin/env python3
"""MXL 안 dynamics·words direction과 잇단(time-modification) 분포 조사."""
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

for part in root.findall(q("part")):
    pid = part.get("id")
    for measure in part.findall(q("measure")):
        mnum = measure.get("number")
        # 마디 안 잇단 노트 유무
        has_tm = any(
            n.find(q("time-modification")) is not None for n in measure.findall(q("note"))
        )
        tuplet_count = sum(
            1
            for n in measure.findall(q("note"))
            for nt in n.findall(q("notations"))
            for t in nt.findall(q("tuplet"))
        )
        for d in measure.findall(q("direction")):
            kinds = []
            for el in d.iter():
                tag = el.tag.split("}")[-1]
                if tag == "dynamics":
                    dyn = ",".join(c.tag.split("}")[-1] for c in el)
                    kinds.append(f"dynamics[{dyn}]")
                elif tag == "words":
                    kinds.append(f"words[{(el.text or '').strip()!r}]")
                elif tag in ("wedge", "pedal", "octave-shift", "bracket", "dashes", "rehearsal"):
                    kinds.append(tag)
            if kinds:
                print(f"{pid} m{mnum} tm={'Y' if has_tm else 'N'} tuplets={tuplet_count}: {' '.join(kinds)} placement={d.get('placement')}")
