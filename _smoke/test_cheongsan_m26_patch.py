#!/usr/bin/env python3
"""청산 26마디 score patch — P1 D5♩ D5♩. E5♪ F5♪ G5♪ 복원."""
from __future__ import annotations

import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from omr_score_patches import apply_score_patches  # noqa: E402

MXL = ROOT / "청산에 살리라 F/_inspect_0ea5/audiveris_raw.mxl"


def load_xml(path: Path) -> tuple[ET.Element, str]:
    with zipfile.ZipFile(path) as z:
        name = [n for n in z.namelist() if n.endswith(".xml")][0]
        raw = z.read(name)
    root = ET.fromstring(raw)
    ns = ""
    if root.tag.startswith("{"):
        ns = root.tag.split("}")[0][1:]
    return root, ns


def note_seq(part_id: str, mnum: str, root: ET.Element, ns: str) -> list[str]:
    part = root.find(f".//{{*}}part[@id='{part_id}']")
    if part is None:
        raise ValueError(f"part {part_id} missing")
    m = part.find(f"{{*}}measure[@number='{mnum}']")
    if m is None:
        raise ValueError(f"measure {mnum} missing in {part_id}")
    out: list[str] = []
    for n in m.findall("{*}note"):
        if n.find("{*}chord") is not None:
            continue
        if n.find("{*}rest") is not None:
            out.append("R")
            continue
        p = n.find("{*}pitch")
        step = p.find("{*}step").text
        octv = p.find("{*}octave").text
        alter = p.find("{*}alter")
        flat = alter is not None and alter.text == "-1"
        dots = len(n.findall("{*}dot"))
        typ = n.find("{*}type").text
        label = f"{step}{'b' if flat else ''}{octv}/{typ}"
        if dots:
            label += "." * dots
        out.append(label)
    return out


def main() -> None:
    import shutil
    import tempfile

    with tempfile.TemporaryDirectory() as td:
        copy = Path(td) / "test.mxl"
        shutil.copy(MXL, copy)
        root, ns = load_xml(copy)
        before = note_seq("P1", "26", root, ns)
        assert before[0].startswith("F5/"), f"fixture unchanged? {before}"

        n = apply_score_patches(root, ns)
        assert n >= 5, f"expected >=5 patches got {n}"

        p1 = note_seq("P1", "26", root, ns)
        assert p1 == ["D5/quarter", "D5/quarter.", "E5/eighth", "F5/eighth", "G5/eighth"], p1

        p2 = note_seq("P2", "26", root, ns)
        assert p2[0].startswith("B4/") and p2[1].startswith("B4/"), p2

        p5 = note_seq("P5", "26", root, ns)
        assert p5[0] == "D5/quarter" and len(p5) == 10, p5

        print("cheongsan m26 patch ok", {"applied": n, "P1": p1})


if __name__ == "__main__":
    main()
