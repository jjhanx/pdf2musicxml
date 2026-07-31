"""Dump m2 P5 staff1 notes: onset, po, dur, pitch."""
import io
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

z = zipfile.ZipFile("omr-work-4637986c.zip")
data = z.read("review.mxl")
inner = zipfile.ZipFile(io.BytesIO(data))
xml_name = [n for n in inner.namelist() if n.endswith(".xml") and "META" not in n.upper()][0]
root = ET.fromstring(inner.read(xml_name))
ns = {"m": "http://www.musicxml.org/ns/partwise"}

def local(tag):
    return tag.split("}")[-1] if "}" in tag else tag

for part in root.findall("m:part", ns) + root.findall("part"):
    pid = part.get("id")
    if pid != "P5":
        continue
    for measure in part:
        if local(measure.tag) != "measure" or measure.get("number") != "2":
            continue
        cursor = 0
        print("=== measure 2 P5 raw document order ===")
        for el in measure:
            tag = local(el.tag)
            if tag == "backup":
                d = int(el.findtext("m:duration", default="0", namespaces=ns) or el.findtext("duration", default="0") or 0)
                cursor = max(0, cursor - d)
                print(f"  backup dur={d} cursor={cursor}")
                continue
            if tag == "forward":
                d = int(el.findtext("m:duration", default="0", namespaces=ns) or el.findtext("duration", default="0") or 0)
                cursor += d
                print(f"  forward dur={d} cursor={cursor}")
                continue
            if tag != "note":
                continue
            chord = el.find("m:chord", ns) is not None or el.find("chord") is not None
            if chord:
                continue
            st = el.findtext("m:staff", default="1", namespaces=ns) or el.findtext("staff", default="1") or "1"
            if st != "1":
                continue
            step = el.findtext("m:step", namespaces=ns) or el.findtext("step") or "?"
            oct = el.findtext("m:octave", namespaces=ns) or el.findtext("octave") or "?"
            alter = el.findtext("m:alter", namespaces=ns) or el.findtext("alter")
            acc = "b" if alter == "-1" else ("#" if alter == "1" else "")
            dur = el.findtext("m:duration", namespaces=ns) or el.findtext("duration") or "?"
            typ = el.findtext("m:type", namespaces=ns) or el.findtext("type") or "?"
            po = el.get("{http://example.com/hitl}data-hitl-play-order") or el.get("data-hitl-play-order")
            voice = el.findtext("m:voice", namespaces=ns) or el.findtext("voice") or "?"
            dx = el.get("default-x")
            print(f"  {step}{acc}{oct} v={voice} onset={cursor} dur={dur} type={typ} po={po} dx={dx}")
            cursor += int(dur or 0)
