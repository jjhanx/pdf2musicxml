#!/usr/bin/env python3
"""Measure duration totals m26/m27 after patch."""
from __future__ import annotations

import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_score_patches import apply_score_patches


def load_mxl(p: Path):
    with zipfile.ZipFile(p) as z:
        c = z.read("META-INF/container.xml").decode()
        rp = re.search(r'full-path="([^"]+)"', c).group(1)
        root = ET.fromstring(z.read(rp))
    ns = root.tag.split("}")[0][1:] if root.tag.startswith("{") else ""
    return root, ns


def q(ns: str, l: str) -> str:
    return f"{{{ns}}}{l}" if ns else l


def local(el: ET.Element) -> str:
    t = el.tag
    return t[t.index("}") + 1 :] if t.startswith("{") else t


def measure_duration(m: ET.Element, ns: str) -> int:
    cur = 0
    total = 0
    for child in m:
        loc = local(child)
        if loc == "forward":
            d = child.find(q(ns, "duration"))
            if d is not None and d.text:
                cur += int(d.text)
        elif loc == "backup":
            d = child.find(q(ns, "duration"))
            if d is not None and d.text:
                cur -= int(d.text)
        elif loc == "note" and child.find(q(ns, "chord")) is None:
            d = child.find(q(ns, "duration"))
            if d is not None and d.text:
                cur += int(d.text)
                total = max(total, cur)
    return max(total, cur)


def expected_duration(part: ET.Element, m: ET.Element, ns: str) -> int | None:
    divisions = beats = beat_type = None
    for pm in part.findall(q(ns, "measure")):
        for attr in pm.findall(q(ns, "attributes")):
            d = attr.find(q(ns, "divisions"))
            if d is not None and d.text and d.text.strip().isdigit():
                divisions = int(d.text.strip())
            t = attr.find(q(ns, "time"))
            if t is not None:
                b = t.find(q(ns, "beats"))
                bt = t.find(q(ns, "beat-type"))
                if b is not None and b.text and bt is not None and bt.text:
                    beats, beat_type = int(b.text), int(bt.text)
        if pm is m:
            break
    if divisions and beats and beat_type:
        return divisions * beats * 4 // beat_type
    return None


def report(root: ET.Element, ns: str, label: str) -> None:
    print(f"\n=== {label} ===")
    for part in root.findall(q(ns, "part")):
        pid = part.get("id")
        for mn in ("26", "27"):
            m = next((x for x in part.findall(q(ns, "measure")) if x.get("number") == mn), None)
            if m is None:
                print(f"{pid} m{mn}: MISSING")
                continue
            dur = measure_duration(m, ns)
            exp = expected_duration(part, m, ns)
            elems = [local(c) for c in m]
            backups = sum(1 for c in m if local(c) == "backup")
            print(f"{pid} m{mn}: dur={dur} expected={exp} ok={dur==exp} backups={backups} elems={elems[:12]}")


def main() -> None:
    p = Path("청산에 살리라 F/_inspect_0ea5/audiveris_raw.mxl")
    root, ns = load_mxl(p)
    report(root, ns, "before")
    apply_score_patches(root, ns)
    report(root, ns, "after patch")


if __name__ == "__main__":
    main()
