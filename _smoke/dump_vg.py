#!/usr/bin/env python3
import io, re, sys, zipfile, xml.etree.ElementTree as ET
path = sys.argv[1]
mn = sys.argv[2]
pid = sys.argv[3]
with zipfile.ZipFile(path) as z:
    c = z.read("META-INF/container.xml").decode()
    rf = re.search(r'full-path="([^"]+)"', c).group(1)
    root = ET.parse(io.BytesIO(z.read(rf))).getroot()
m = re.match(r"\{(.*)\}", root.tag)
ns = m.group(1) if m else ""
q = lambda t: f"{{{ns}}}{t}" if ns else t
for part in root.findall(q("part")):
    if part.get("id") != pid:
        continue
    for measure in part.findall(q("measure")):
        if measure.get("number") != mn:
            continue
        div = beats = bt = None
        for attr in measure.findall(q("attributes")):
            d = attr.find(q("divisions"))
            if d is not None and d.text:
                div = int(d.text)
            t = attr.find(q("time"))
            if t is not None:
                beats = int(t.find(q("beats")).text)
                bt = int(t.find(q("beat-type")).text)
        exp = div * beats * 4 // bt if div and beats and bt else None
        print(f"div={div} exp={exp}")
        for (_, voice), groups in __import__('fix_audiveris_mxl', fromlist=['_voice_groups'])._voice_groups(measure, ns).items():
            total = sum(__import__('fix_audiveris_mxl', fromlist=['_note_duration'])._note_duration(g[0], ns) or 0 for g in groups)
            items = []
            for g in groups:
                leader = g[0]
                dur = __import__('fix_audiveris_mxl', fromlist=['_note_duration'])._note_duration(leader, ns)
                typ = leader.find(q('type')).text if leader.find(q('type')) is not None else '?'
                rest = leader.find(q('rest')) is not None
                if rest:
                    p = 'R'
                else:
                    pe = leader.find(q('pitch'))
                    p = pe.find(q('step')).text + pe.find(q('octave')).text
                items.append(f"{p}:{typ}({dur})")
            print(f" staff voice {voice} total={total}: {' | '.join(items)}")
