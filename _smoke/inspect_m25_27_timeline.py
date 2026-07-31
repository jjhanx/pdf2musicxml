#!/usr/bin/env python3
"""Inspect m25-27 timeline/print in raw cheongsan."""
from __future__ import annotations

import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


def load(p: Path):
    with zipfile.ZipFile(p) as z:
        c = z.read("META-INF/container.xml").decode()
        rp = re.search(r'full-path="([^"]+)"', c).group(1)
        root = ET.fromstring(z.read(rp))
    ns = root.tag.split("}")[0][1:] if root.tag.startswith("{") else ""
    return root, ns


def q(ns, l):
    return f"{{{ns}}}{l}" if ns else l


def local(el):
    t = el.tag
    return t[t.index("}") + 1 :] if t.startswith("{") else t


def dur_end(m, ns):
    pos = 0
    mx = 0
    for c in m:
        loc = local(c)
        if loc == "backup":
            d = c.find(q(ns, "duration"))
            if d is not None and d.text:
                pos -= int(d.text)
        elif loc == "forward":
            d = c.find(q(ns, "duration"))
            if d is not None and d.text:
                pos += int(d.text)
        elif loc == "note" and c.find(q(ns, "chord")) is None:
            d = c.find(q(ns, "duration"))
            if d is not None and d.text:
                pos += int(d.text)
                mx = max(mx, pos)
    return max(mx, pos)


def main():
    p = Path("청산에 살리라 F/_inspect_0ea5/audiveris_raw.mxl")
    root, ns = load(p)
    for pid in ["P1", "P5"]:
        part = next(x for x in root.findall(q(ns, "part")) if x.get("id") == pid)
        for mn in ["25", "26", "27"]:
            m = next(x for x in part.findall(q(ns, "measure")) if x.get("number") == mn)
            elems = [local(c) for c in m]
            prints = []
            for c in m:
                if local(c) == "print":
                    prints.append(ET.tostring(c, encoding="unicode")[:120])
            backups = sum(1 for c in m if local(c) == "backup")
            print(f"{pid} m{mn}: dur={dur_end(m,ns)} backups={backups} elems={elems[:14]}")
            for pr in prints:
                print(f"  print: {pr}")


if __name__ == "__main__":
    main()
