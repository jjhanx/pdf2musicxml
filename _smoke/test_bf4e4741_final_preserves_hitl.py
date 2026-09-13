#!/usr/bin/env python3
"""bf4e4741: 최종 후처리 후에도 HITL SATB 쉼표·PL m7 다성을 보존."""
from __future__ import annotations

import io
import re
import shutil
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "_smoke" / "_bf4e4741_final"
sys.path.insert(0, str(ROOT / "scripts"))


def load_mxl(p: Path) -> ET.Element:
    with zipfile.ZipFile(p) as z:
        c = z.read("META-INF/container.xml").decode()
        rn = re.search(r'full-path="([^"]+)"', c).group(1)
        return ET.parse(io.BytesIO(z.read(rn))).getroot()


def local(t: str) -> str:
    return t.split("}")[-1] if "}" in t else t


def pitched_count(root: ET.Element, pid: str, n: int) -> int:
    for el in root:
        if local(el.tag) != "part" or el.get("id") != pid:
            continue
        for m in el:
            if local(m.tag) != "measure" or int(m.get("number") or 0) != n:
                continue
            return sum(
                1
                for note in m
                if local(note.tag) == "note"
                and not any(local(c.tag) == "rest" for c in note)
            )
    return -1


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(ROOT / "omr-work-bf4e4741.zip") as z:
        z.extract("review.mxl", OUT)
        z.extract("part_labels.json", OUT)

    review = OUT / "review.mxl"
    work = OUT / "final_pipeline.mxl"
    shutil.copy(review, work)

    from fix_audiveris_mxl import fix_mxl_file
    from restructure_mxl_parts import restructure_mxl

    fix_mxl_file(work, work)
    restructure_mxl(work, work, OUT / "part_labels.json")

    before = load_mxl(review)
    after = load_mxl(work)

    # PL m7: LH arpeggio must survive fix
    assert pitched_count(after, "P5", 7) >= pitched_count(before, "P5", 7) - 1, (
        f"PL m7 pitched {pitched_count(before, 'P5', 7)} -> {pitched_count(after, 'P5', 7)}"
    )
    assert pitched_count(after, "P5", 7) >= 18, pitched_count(after, "P5", 7)

    # Women section: T/B stay rests
    for n in range(10, 19):
        assert pitched_count(after, "P3", n) == 0, f"T m{n} pitched={pitched_count(after, 'P3', n)}"
        assert pitched_count(after, "P4", n) == 0, f"B m{n} pitched={pitched_count(after, 'P4', n)}"
        assert pitched_count(after, "P1", n) == pitched_count(before, "P1", n)
        assert pitched_count(after, "P2", n) == pitched_count(before, "P2", n)

    # Men section: S/A stay rests
    for n in range(20, 27):
        assert pitched_count(after, "P1", n) == 0, f"S m{n} pitched={pitched_count(after, 'P1', n)}"
        assert pitched_count(after, "P2", n) == 0, f"A m{n} pitched={pitched_count(after, 'P2', n)}"
        assert pitched_count(after, "P3", n) == pitched_count(before, "P3", n)
        assert pitched_count(after, "P4", n) == pitched_count(before, "P4", n)

    print("ok")


if __name__ == "__main__":
    main()
