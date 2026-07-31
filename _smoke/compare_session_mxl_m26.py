#!/usr/bin/env python3
from __future__ import annotations

import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


def p1_m26_notes(mxl: Path) -> list[str]:
    with zipfile.ZipFile(mxl) as z:
        c = z.read("META-INF/container.xml").decode()
        rp = re.search(r'full-path="([^"]+)"', c).group(1)
        root = ET.fromstring(z.read(rp))
    part = next(p for p in root.findall(".//{*}part") if p.get("id") == "P1")
    m = next(x for x in part.findall("{*}measure") if x.get("number") == "26")
    out = []
    for n in m.findall("{*}note"):
        if n.find("{*}chord") is not None:
            continue
        if n.find("{*}rest") is not None:
            out.append("R")
            continue
        p = n.find("{*}pitch")
        out.append(p.find("{*}step").text + p.find("{*}octave").text)
    return out


def main() -> None:
    base = Path("청산에 살리라 F/_inspect_0ea5")
    for name in ("audiveris_raw.mxl", "review.mxl", "omr_hitl_baseline.mxl"):
        p = base / name
        if p.exists():
            print(name, p1_m26_notes(p))


if __name__ == "__main__":
    main()
