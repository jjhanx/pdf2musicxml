#!/usr/bin/env python3
"""Apply OSMD preview timeline cleanup to MusicXML (mirror TS logic)."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def local(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def has_note_after(measure: ET.Element, index: int) -> bool:
    kids = list(measure)
    for i in range(index + 1, len(kids)):
        if local(kids[i].tag) == "note":
            return True
    return False


def has_note_before(measure: ET.Element, index: int) -> bool:
    kids = list(measure)
    for i in range(0, index):
        if local(kids[i].tag) == "note":
            return True
    return False


def remove_dangling_timeline(measure: ET.Element) -> int:
    removed = 0
    for child in list(measure):
        tag = local(child.tag)
        if tag not in ("backup", "forward"):
            continue
        idx = list(measure).index(child)
        if not has_note_after(measure, idx):
            measure.remove(child)
            removed += 1
            continue
        if not has_note_before(measure, idx):
            measure.remove(child)
            removed += 1
    return removed


def strip_new_page(doc: ET.Element) -> None:
    for el in doc.iter():
        if local(el.tag) != "print":
            continue
        if el.get("new-page") == "yes":
            del el.attrib["new-page"]
        if not el.attrib and len(el) == 0:
            parent = next((p for p in doc.iter() if el in list(p)), None)
            if parent is not None:
                parent.remove(el)


def cleanup_xml(xml: str) -> tuple[str, int]:
    root = ET.fromstring(xml)
    n = 0
    for part in root.iter():
        if local(part.tag) != "part":
            continue
        for measure in part:
            if local(measure.tag) != "measure":
                continue
            n += remove_dangling_timeline(measure)
    strip_new_page(root)
    body = ET.tostring(root, encoding="unicode")
    if not body.startswith("<?xml"):
        body = '<?xml version="1.0" encoding="UTF-8"?>\n' + body
    return body, n


def main() -> None:
    src = Path("_smoke/_cheongsan_review.xml")
    raw = src.read_text(encoding="utf-8")
    cleaned, n = cleanup_xml(raw)
    out = Path("_smoke/_cheongsan_cleaned.xml")
    out.write_text(cleaned, encoding="utf-8")
    print("removed dangling", n, "->", out)


if __name__ == "__main__":
    main()
