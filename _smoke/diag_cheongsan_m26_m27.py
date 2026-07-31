#!/usr/bin/env python3
"""Diagnose m25-28 before/after score patch."""
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


def pitch(n: ET.Element, ns: str) -> str:
    if n.find(q(ns, "rest")) is not None:
        return "REST"
    p = n.find(q(ns, "pitch"))
    if p is None:
        return "?"
    s = p.find(q(ns, "step")).text
    o = p.find(q(ns, "octave")).text
    a = p.find(q(ns, "alter"))
    suf = ""
    if a is not None and a.text:
        ai = int(float(a.text))
        suf = "#" if ai == 1 else ("b" if ai == -1 else "")
    return f"{s}{suf}{o}"


def dump_measures(root: ET.Element, ns: str, label: str, nums: set[str]) -> None:
    print(f"\n=== {label} ===")
    for mn in sorted(nums, key=int):
        print(f"-- m{mn} --")
        for part in root.findall(q(ns, "part")):
            pid = part.get("id") or "?"
            m = next((x for x in part.findall(q(ns, "measure")) if x.get("number") == mn), None)
            if m is None:
                print(f"  {pid}: MISSING MEASURE")
                continue
            notes = []
            for c in m:
                if local(c) != "note" or c.find(q(ns, "chord")) is not None:
                    continue
                typ = c.find(q(ns, "type"))
                t = typ.text if typ is not None else "?"
                d = c.find(q(ns, "dot")) is not None
                v = c.find(q(ns, "voice"))
                vo = v.text if v is not None else "1"
                s = c.find(q(ns, "staff"))
                st = s.text if s is not None else "-"
                notes.append((pitch(c, ns), t, d, vo, st))
            attrs = [local(c) for c in m if local(c) in ("attributes", "barline", "print")]
            print(f"  {pid}: notes={notes} attrs={attrs}")


def main() -> None:
    base = Path(__file__).resolve().parents[1]
    for name in ("audiveris_raw.mxl", "review.mxl", "omr_hitl_baseline.mxl"):
        p = base / "청산에 살리라 F/_inspect_0ea5" / name
        if not p.exists():
            continue
        root, ns = load_mxl(p)
        dump_measures(root, ns, f"{name} (as stored)", {"25", "26", "27", "28"})

        root2, ns2 = load_mxl(p)
        applied = apply_score_patches(root2, ns2)
        dump_measures(root2, ns2, f"{name} after patch (applied={applied})", {"25", "26", "27", "28"})


if __name__ == "__main__":
    main()
