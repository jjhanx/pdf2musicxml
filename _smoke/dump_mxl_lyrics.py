#!/usr/bin/env python3
"""Dump lyrics by measure/part from MXL."""
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET


def mxl_ns_uri(root):
    if root.tag.startswith("{"):
        return root.tag.split("}")[0][1:]
    return ""


def qname(ns, local):
    return f"{{{ns}}}{local}" if ns else local


def dump(mxl_path, measures=(13, 14, 15, 16)):
    with zipfile.ZipFile(mxl_path, "r") as z:
        container = z.read("META-INF/container.xml").decode("utf-8")
        m = re.search(r'full-path="([^"]+)"', container)
        root_file = m.group(1) if m else None
        root = ET.parse(io.BytesIO(z.read(root_file))).getroot()
    ns = mxl_ns_uri(root)
    parts = root.findall(f".//{qname(ns, 'part')}")
    print(f"\n=== {mxl_path} ===")
    for pi, part in enumerate(parts, 1):
        score_part = part.find(qname(ns, "score-part"))
        name = score_part.get("id") if score_part is not None else str(pi)
        print(f"\n-- Part {pi} ({name}) --")
        for measure in part.findall(qname(ns, "measure")):
            num = measure.get("number", "?")
            try:
                n = int(num)
            except ValueError:
                continue
            if n not in measures:
                continue
            syllables = []
            for note in measure.findall(qname(ns, "note")):
                for lyric in note.findall(qname(ns, "lyric")):
                    text_el = lyric.find(qname(ns, "text"))
                    if text_el is not None and text_el.text:
                        syllables.append(text_el.text)
            if syllables:
                print(f"  m{num}: {''.join(syllables)}")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        dump(p)
