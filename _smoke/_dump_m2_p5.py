import io, sys, zipfile, xml.etree.ElementTree as ET

z = zipfile.ZipFile("omr-work-4637986c.zip")
data = z.read("review.mxl")
inner = zipfile.ZipFile(io.BytesIO(data))
xml = inner.read([n for n in inner.namelist() if n.endswith(".xml") and "META" not in n.upper()][0])
root = ET.fromstring(xml)

def local(t):
    return t.tag.split("}")[-1] if "}" in t.tag else t.tag

for part in root.iter():
    if local(part) != "part" or part.get("id") != "P5":
        continue
    for m in part:
        if local(m) != "measure" or m.get("number") != "2":
            continue
        i = -1
        for c in m:
            if local(c) != "note":
                continue
            i += 1
            st = next((x.text for x in c if local(x) == "staff"), "?")
            if st and st != "1":
                continue
            pe = [x for x in c if local(x) == "pitch"]
            voice = next((x.text for x in c if local(x) == "voice"), "?")
            po = c.get("data-hitl-play-order")
            dur = next((x.text for x in c if local(x) == "duration"), "?")
            chord = any(local(x) == "chord" for x in c)
            if not pe:
                print(f"idx={i} rest chord={chord} v={voice} po={po} dur={dur}")
                continue
            s = next((x.text for x in pe[0] if local(x) == "step"), "")
            o = next((x.text for x in pe[0] if local(x) == "octave"), "")
            a = next((x.text for x in pe[0] if local(x) == "alter"), None)
            acc = "-" if a == "-1" else ("#" if a == "1" else "")
            print(f"idx={i} {s}{acc}{o} chord={chord} v={voice} po={po} dur={dur}")
