#!/usr/bin/env python3
"""Inspect m31-34 keys/clefs in omr-work-1b1b34df."""
import io
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ZIP = Path(r"D:/pdf2musicxml/omr-work-1b1b34df.zip")


def local(el):
    if isinstance(el, str):
        return el
    return el.tag.split("}")[-1] if "}" in el.tag else el.tag


def load(name):
    with zipfile.ZipFile(ZIP) as z:
        data = z.read(name)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        xml = z.read([n for n in z.namelist() if n.endswith(".xml") and "META" not in n.upper()][0])
    return ET.fromstring(xml)


def sig(el):
    if el is None:
        return None
    if local(el.tag) == "key":
        f = el.find("{*}fifths")
        return f"key fifths={f.text if f is not None else '?'}"
    if local(el.tag) == "clef":
        sign = el.find("{*}sign")
        line = el.find("{*}line")
        num = el.get("number", "1")
        return f"clef#{num} {sign.text if sign is not None else '?'} line={line.text if line is not None else '?'}"
    return local(el.tag)


def dump_part(part_id, root, mnums=(31, 32, 33, 34)):
    part = next(p for p in root.findall(".//{*}part") if p.get("id") == part_id)
    print(f"\n=== {part_id} ===")
    for mn in mnums:
        m = next((x for x in part.findall("{*}measure") if x.get("number") == str(mn)), None)
        if m is None:
            print(f" m{mn}: MISSING")
            continue
        attrs = []
        for child in m:
            tag = local(child)
            if tag == "attributes":
                for a in child:
                    if not hasattr(a, "tag"):
                        continue
                    attrs.append(sig(a))
            elif tag == "note":
                for n in child.findall(".//{*}clef"):
                    attrs.append("NOTE-ATTACHED " + sig(n))
        bar = m.find(".//{*}barline")
        bar_loc = bar.get("location") if bar is not None else None
        print(f" m{mn} attrs={attrs or '-'} barline={bar_loc}")


for mxl in ("audiveris_raw.mxl", "review.mxl", "omr_hitl_baseline.mxl"):
    print("\n########", mxl, "########")
    root = load(mxl)
    parts = [p.get("id") for p in root.findall(".//{*}part")]
    print("parts", parts)
    for pid in parts:
        dump_part(pid, root)
