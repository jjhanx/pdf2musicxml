#!/usr/bin/env python3
import io, re, sys, zipfile, xml.etree.ElementTree as ET
path = sys.argv[1]
with zipfile.ZipFile(path) as z:
    c = z.read("META-INF/container.xml").decode()
    rf = re.search(r'full-path="([^"]+)"', c).group(1)
    root = ET.parse(io.BytesIO(z.read(rf))).getroot()
m = re.match(r"\{(.*)\}", root.tag)
ns = m.group(1) if m else ""
q = lambda t: f"{{{ns}}}{t}" if ns else t
fifths = None
for part in root.findall(q("part")):
    if part.get("id") != "P5":
        continue
    for measure in part.findall(q("measure")):
        mn = measure.get("number")
        for attr in measure.findall(q("attributes")):
            ks = attr.find(q("key"))
            if ks is not None:
                f = ks.find(q("fifths"))
                if f is not None:
                    fifths = f.text
        if mn in {"44", "48", "50"}:
            total = 0
            chords = 0
            for n in measure.findall(q("note")):
                st = n.find(q("staff"))
                if st is not None and st.text != "2" and mn == "44":
                    continue
                if st is not None and st.text != "1" and mn != "44":
                    continue
                if n.find(q("chord")) is None:
                    chords += 1
                d = n.find(q("duration"))
                if d is not None and d.text and n.find(q("chord")) is None:
                    total += int(d.text)
            print(f"m{mn} fifths={fifths} chord_heads={chords} dur_sum_sample={total}")
