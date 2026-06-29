#!/usr/bin/env python3
import io, re, sys, zipfile, xml.etree.ElementTree as ET
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        return ET.parse(io.BytesIO(z.read(rf))).getroot()

path = sys.argv[1]
root = load(path)
m = re.match(r"\{(.*)\}", root.tag)
ns = m.group(1) if m else ""
for part in root.findall(fix.qname(ns, "part")):
    if part.get("id") != "P5":
        continue
    for measure, div, exp in fix._iter_measures_with_timing(part, ns):
        mn = measure.get("number")
        for (st, vo), groups in fix._voice_groups(measure, ns).items():
            total = sum(fix._note_duration(g[0], ns) or 0 for g in groups)
            if total and exp and total != exp:
                print(f"m{mn} staff{st} voice{vo} total={total} expected={exp}")
