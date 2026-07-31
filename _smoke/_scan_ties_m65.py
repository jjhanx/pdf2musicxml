#!/usr/bin/env python3
from __future__ import annotations

import io
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


def check(zpath: Path) -> None:
    with zipfile.ZipFile(zpath) as z:
        name = next((n for n in z.namelist() if n.endswith("review.mxl")), None)
        if not name:
            return
        data = z.read(name)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        xml = z.read([n for n in z.namelist() if n.endswith(".xml") and "META" not in n][0])
    root = ET.fromstring(xml)
    labels = {}
    for sp in root.findall(".//{*}score-part"):
        pn = sp.find("{*}part-name")
        labels[sp.get("id")] = pn.text if pn is not None else ""
    for part in root.findall("{*}part"):
        pid = part.get("id")
        for m in part.findall("{*}measure"):
            if m.get("number") not in ("64", "65", "66", "67"):
                continue
            for n in m.findall("{*}note"):
                tied = n.findall(".//{*}tied")
                tie = n.findall("{*}tie")
                if not tied and not tie:
                    continue
                pitch = n.find("{*}pitch")
                p = "?"
                if pitch is not None:
                    p = f"{pitch.find('{*}step').text}{pitch.find('{*}octave').text}"
                print(
                    zpath.name,
                    labels.get(pid),
                    pid,
                    "m" + m.get("number"),
                    p,
                    [(t.get("type"), t.get("placement")) for t in tied],
                    [(t.get("type"), t.get("placement")) for t in tie],
                )


def main() -> None:
    zips = list(Path(".").glob("omr-work*.zip"))
    folder = Path("청산에 살리라 F")
    if folder.exists():
        zips += list(folder.glob("omr-work*.zip"))
    for z in zips:
        try:
            check(z)
        except Exception as e:
            print(z, e)


if __name__ == "__main__":
    main()
