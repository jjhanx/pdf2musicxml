#!/usr/bin/env python3
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

with zipfile.ZipFile("_smoke/omr-work-2e86a8e0/audiveris_raw.mxl") as z:
    c = z.read("META-INF/container.xml").decode()
    rf = re.search(r'full-path="([^"]+)"', c).group(1)
    root = ET.parse(io.BytesIO(z.read(rf))).getroot()
m = re.match(r"\{(.*)\}", root.tag)
ns = m.group(1) if m else ""
q = lambda t: f"{{{ns}}}{t}"


def is_eighth(n):
    return fix._note_type_text(n, ns) == "eighth" and n.find(q("dot")) is None


def is_quarter(n):
    return fix._note_type_text(n, ns) == "quarter" and n.find(q("dot")) is None


part = [p for p in root.findall(q("part")) if p.get("id") == "P5"][0]
for measure in part.findall(q("measure")):
    mnum = measure.get("number")
    for staff in ("1", "2"):
        groups = []
        cur = None
        for child in measure:
            if child.tag.split("}")[-1] != "note":
                continue
            st_el = child.find(q("staff"))
            st = st_el.text if st_el is not None else "1"
            if st != staff:
                continue
            if child.find(q("chord")) is not None:
                if cur:
                    cur[1].append(child)
                continue
            cur = (child, [child])
            groups.append(cur)
        for i in range(len(groups) - 1):
            if is_quarter(groups[i][0]) and is_quarter(groups[i + 1][0]):
                prev_beam = i > 0 and bool(groups[i - 1][0].findall(q("beam")))
                if prev_beam or (i >= 2 and is_eighth(groups[i - 2][0])):
                    print(f"m{mnum} staff{staff}: qq at {i},{i+1} prev_beam={prev_beam}")
