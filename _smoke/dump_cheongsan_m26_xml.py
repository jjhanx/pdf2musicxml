#!/usr/bin/env python3
"""청산 review.mxl — 24~28마디 XML 상세."""
from __future__ import annotations

import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

MXL = Path("청산에 살리라 F/_inspect_0ea5/review.mxl")


def local(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def dump_measure(meas: ET.Element, pid: str) -> None:
    num = meas.get("number")
    print(f"\n=== {pid} m{num} ===")
    for child in meas:
        tag = local(child.tag)
        if tag == "note":
            rest = child.find(".//{*}rest") is not None or child.find("rest") is not None
            voice = child.findtext(".//{*}voice") or child.findtext("voice") or "?"
            staff = child.findtext(".//{*}staff") or child.findtext("staff") or "?"
            dur = child.findtext(".//{*}duration") or child.findtext("duration") or "?"
            typ = child.findtext(".//{*}type") or child.findtext("type") or "?"
            chord = any(local(c.tag) == "chord" for c in child)
            pitch = child.find(".//{*}pitch") or child.find("pitch")
            p = "R"
            if pitch is not None:
                step = pitch.findtext(".//{*}step") or pitch.findtext("step") or "?"
                octv = pitch.findtext(".//{*}octave") or pitch.findtext("octave") or "?"
                p = f"{step}{octv}"
            print(
                f"  note v={voice} staff={staff} dur={dur} type={typ}"
                f" {'chord' if chord else ''} {'rest' if rest else p}"
            )
        elif tag in ("attributes", "direction", "barline", "print", "backup", "forward"):
            ET.indent(child, space="  ")
            frag = ET.tostring(child, encoding="unicode")
            if len(frag) > 400:
                frag = frag[:400] + "..."
            print(f"  {tag}: {frag.replace(chr(10), ' ')}")


def main() -> None:
    with zipfile.ZipFile(MXL) as z:
        root = ET.fromstring(z.read([n for n in z.namelist() if n.endswith(".xml")][0]))
    for part in root:
        if local(part.tag) != "part":
            continue
        pid = part.get("id") or "?"
        for meas in part:
            if local(meas.tag) != "measure":
                continue
            n = int(meas.get("number") or 0)
            if 24 <= n <= 28:
                dump_measure(meas, pid)


if __name__ == "__main__":
    main()
