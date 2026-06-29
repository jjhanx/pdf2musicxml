#!/usr/bin/env python3
"""_ensure_tuplet_notations 합성 테스트: tuplet 요소 제거 후 복원되는지."""
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from fix_audiveris_mxl import _ensure_tuplet_notations, qname

with zipfile.ZipFile("test-out/clean_score_only.mxl") as z:
    container = z.read("META-INF/container.xml").decode("utf-8")
    rootfile = re.search(r'full-path="([^"]+)"', container).group(1)
    data = z.read(rootfile)

root = ET.parse(io.BytesIO(data)).getroot()
m = re.match(r"\{(.*)\}", root.tag)
ns = m.group(1) if m else ""

# 모든 tuplet 요소 제거 (Audiveris가 tuplet 표기를 빠뜨린 상황 재현)
stripped = 0
for note in root.iter(qname(ns, "note")):
    for notations in note.findall(qname(ns, "notations")):
        for t in list(notations.findall(qname(ns, "tuplet"))):
            notations.remove(t)
            stripped += 1

added = 0
for part in root.findall(qname(ns, "part")):
    added += _ensure_tuplet_notations(part, ns)

print(f"stripped tuplet elements: {stripped}")
print(f"tuplet groups injected: {added}")

# 주입 결과 확인
for part in root.findall(qname(ns, "part")):
    pid = part.get("id")
    for measure in part.findall(qname(ns, "measure")):
        for note in measure.findall(qname(ns, "note")):
            for notations in note.findall(qname(ns, "notations")):
                for t in notations.findall(qname(ns, "tuplet")):
                    print(
                        f"{pid} m{measure.get('number')}: tuplet {t.get('type')}"
                        f" show={t.get('show-number')} plc={t.get('placement')}"
                    )
