#!/usr/bin/env python3
"""Dump m65 T/B notes, stems, ties, slurs."""
from __future__ import annotations

import io
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def dump(zpath: Path) -> None:
    with zipfile.ZipFile(zpath) as z:
        data = z.read("review.mxl")
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        xml = z.read([n for n in z.namelist() if n.endswith(".xml") and "META" not in n][0])
    root = ET.fromstring(xml)
    print(f"=== {zpath.name} ===")
    for part in root.findall("{*}part"):
        pid = part.get("id")
        for m in part.findall("{*}measure"):
            if m.get("number") != "65":
                continue
            # score-part name
            print(f"--- part {pid} ---")
            for c in m:
                if local(c.tag) != "note":
                    continue
                pitch = c.find("{*}pitch")
                rest = c.find("{*}rest") is not None
                if pitch is not None:
                    alter = pitch.find("{*}alter")
                    a = alter.text if alter is not None and alter.text else ""
                    p = f"{pitch.find('{*}step').text}{a}{pitch.find('{*}octave').text}"
                else:
                    p = "rest" if rest else "?"
                stem_el = c.find("{*}stem")
                stem = stem_el.text if stem_el is not None else "-"
                typ = c.find("{*}type")
                typ_t = typ.text if typ is not None else "?"
                ties = []
                for t in c.findall("{*}tie"):
                    ties.append(("tie", t.get("type"), t.get("placement"), t.get("orientation")))
                notations = c.find("{*}notations")
                if notations is not None:
                    for t in notations.findall("{*}tied"):
                        ties.append(("tied", t.get("type"), t.get("placement"), t.get("orientation")))
                    for s in notations.findall("{*}slur"):
                        ties.append(("slur", s.get("type"), s.get("placement"), s.get("orientation")))
                print(f"  {p} {typ_t} stem={stem} {ties}")


def main() -> None:
    for z in [
        "omr-work-23ddc764.zip",
        "청산에 살리라 F/omr-work-23ddc764.zip",
        "omr-work-ddbf5994.zip",
        "청산에 살리라 F/omr-work-ddbf5994.zip",
        "omr-work-243d24f6.zip",
        "청산에 살리라 F/omr-work-243d24f6.zip",
    ]:
        p = Path(z)
        if p.exists():
            try:
                dump(p)
            except Exception as e:
                print(p, e)


if __name__ == "__main__":
    main()
