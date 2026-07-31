#!/usr/bin/env python3
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


def dump_part(mxl: Path, pid: str, nums=("24", "25", "26", "27", "28")) -> None:
    with zipfile.ZipFile(mxl) as z:
        root = ET.fromstring(z.read([n for n in z.namelist() if n.endswith(".xml")][0]))
    part = root.find(f".//{{*}}part[@id='{pid}']")
    if part is None:
        print(pid, "missing")
        return
    for m in part.findall("{*}measure"):
        n = m.get("number")
        if n not in nums:
            continue
        notes = []
        for note in m.findall("{*}note"):
            if note.find("{*}rest") is not None:
                notes.append("R")
                continue
            p = note.find("{*}pitch")
            typ = note.find("{*}type")
            if p is None:
                notes.append("?")
                continue
            pitch = p.find("{*}step").text + p.find("{*}octave").text
            if typ is not None and typ.text:
                pitch += "/" + typ.text
            notes.append(pitch)
        print(f"  {pid} m{n}: {notes}")


def main() -> None:
    base = Path("청산에 살리라 F/_inspect_0ea5")
    for name in ("audiveris_raw.mxl", "review.mxl"):
        mxl = base / name
        print("===", name, "===")
        for pid in ("P1", "P2", "P3", "P4", "P5"):
            dump_part(mxl, pid)


if __name__ == "__main__":
    main()
