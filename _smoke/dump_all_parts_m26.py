#!/usr/bin/env python3
from __future__ import annotations

import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


def dump(path: Path) -> None:
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        rp = re.search(r'full-path="([^"]+)"', c).group(1)
        root = ET.fromstring(z.read(rp))
    print(f"=== {path.name} ===")
    for part in root.findall(".//{*}part"):
        pid = part.get("id", "")
        if not pid.startswith("P"):
            continue
        m = next((x for x in part.findall("{*}measure") if x.get("number") == "26"), None)
        if m is None:
            print(f"  {pid} m26: MISSING")
            continue
        notes: list[str] = []
        for n in m.findall("{*}note"):
            if n.find("{*}chord") is not None:
                continue
            if n.find("{*}rest") is not None:
                notes.append("REST")
                continue
            p = n.find("{*}pitch")
            notes.append(p.find("{*}step").text + p.find("{*}octave").text)
        print(f"  {pid} m26: {notes}")


def main() -> None:
    base = Path("청산에 살리라 F/_inspect_0ea5")
    for name in ("audiveris_raw.mxl", "review.mxl", "omr_hitl_baseline.mxl"):
        p = base / name
        if p.exists():
            dump(p)
            print()


if __name__ == "__main__":
    main()
