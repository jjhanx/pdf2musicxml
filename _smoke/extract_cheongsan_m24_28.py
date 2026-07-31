#!/usr/bin/env python3
"""청산 P1 m24-28 + 전체 파트 발췌 MusicXML (OSMD node 테스트용)."""
from __future__ import annotations

import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

SRC = Path("청산에 살리라 F/_inspect_0ea5/review.mxl")
OUT_P1 = Path("_smoke/_cheongsan_p1_m24_28.xml")
OUT_FULL = Path("_smoke/_cheongsan_m24_28_full.xml")


def local(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def load_root() -> ET.Element:
    with zipfile.ZipFile(SRC) as z:
        return ET.fromstring(z.read([n for n in z.namelist() if n.endswith(".xml") and "META" not in n][0]))


def part_list_snippet(root: ET.Element, part_ids: list[str]) -> ET.Element:
    pl = None
    for child in root:
        if local(child.tag) == "part-list":
            pl = child
            break
    assert pl is not None
    new_pl = ET.Element("part-list")
    for sp in pl:
        if local(sp.tag) != "score-part":
            continue
        if sp.get("id") in part_ids:
            new_pl.append(sp)
    return new_pl


def extract_measures(part: ET.Element, lo: int, hi: int, renumber: bool = False) -> ET.Element:
    ns = part.tag.split("}")[0] + "}" if "}" in part.tag else ""
    new_part = ET.Element(f"{ns}part", {"id": part.get("id") or "P1"})
    n = 1
    for meas in part:
        if local(meas.tag) != "measure":
            continue
        num = int(meas.get("number") or 0)
        if lo <= num <= hi:
            m = ET.fromstring(ET.tostring(meas))
            if renumber:
                m.set("number", str(n))
                n += 1
            new_part.append(m)
    return new_part


def build_score(root: ET.Element, part_ids: list[str], lo: int, hi: int, renumber=False) -> ET.Element:
    ns = root.tag.split("}")[0] + "}" if "}" in root.tag else ""
    score = ET.Element(f"{ns}score-partwise", {"version": "4.0"})
    score.append(part_list_snippet(root, part_ids))
    for pid in part_ids:
        for part in root:
            if local(part.tag) == "part" and part.get("id") == pid:
                score.append(extract_measures(part, lo, hi, renumber=renumber))
                break
    return score


def strip_m25_trailing_backup(part: ET.Element) -> None:
    for meas in part:
        if local(meas.tag) != "measure" or meas.get("number") != "25":
            continue
        kids = list(meas)
        for i in range(len(kids) - 1, -1, -1):
            c = kids[i]
            if local(c.tag) not in ("backup", "forward"):
                continue
            has_after = any(local(meas[j].tag) == "note" for j in range(i + 1, len(meas)))
            if not has_after:
                meas.remove(c)


def write_xml(path: Path, score: ET.Element) -> None:
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(score, encoding="unicode")
    path.write_text(xml, encoding="utf-8")


def main() -> None:
    root = load_root()
    p1 = build_score(root, ["P1"], 24, 28)
    write_xml(OUT_P1, p1)

    p1_clean = build_score(root, ["P1"], 24, 28)
    for part in p1_clean:
        if local(part.tag) == "part":
            strip_m25_trailing_backup(part)
    write_xml(Path("_smoke/_cheongsan_p1_m24_28_nobackup.xml"), p1_clean)

    full = build_score(root, ["P1", "P2", "P3", "P4", "P5"], 24, 28)
    write_xml(OUT_FULL, full)

    full_clean = build_score(root, ["P1", "P2", "P3", "P4", "P5"], 24, 28)
    for part in full_clean:
        if local(part.tag) == "part":
            strip_m25_trailing_backup(part)
    write_xml(Path("_smoke/_cheongsan_m24_28_full_nobackup.xml"), full_clean)
    print("wrote snippets")


if __name__ == "__main__":
    main()
