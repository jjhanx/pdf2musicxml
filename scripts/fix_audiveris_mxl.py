#!/usr/bin/env python3
"""Audiveris MXL 후처리 — 성부 약어·OCR 잔여로 생긴 흔한 오인식 완화."""
from __future__ import annotations

import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

# TEXTS/SYMBOLS 단계에서 세잇단 숫자·성부 약어(P, 2P)가 겹쳐 들어온 경우
_SPURIOUS_DIRECTION_WORDS = frozenset(
    {
        "P",
        "p",
        "2P",
        "2p",
        "PR",
        "PL",
        "R",
        "L",
    }
)

# 단독 숫자(마디 밖 OCR 잔여) — 가사·마디번호 주입과 무관한 direction만
_SPURIOUS_DIRECTION_DIGITS = frozenset({"9"})


def mxl_ns_uri(root: ET.Element) -> str:
    t = root.tag
    if t.startswith("{"):
        return t[1 : t.index("}")]
    return ""


def qname(ns: str, local: str) -> str:
    return f"{{{ns}}}{local}" if ns else local


def local_tag(el: ET.Element) -> str:
    t = el.tag
    if t.startswith("{"):
        return t[t.index("}") + 1 :]
    return t


def _direction_text(direction: ET.Element, ns: str) -> str:
    parts: list[str] = []
    for el in direction.iter():
        if local_tag(el) in ("words", "text", "syllable"):
            if el.text and el.text.strip():
                parts.append(el.text.strip())
    return " ".join(parts).strip()


def _is_spurious_direction(direction: ET.Element, ns: str) -> bool:
    text = _direction_text(direction, ns)
    if not text:
        return False
    compact = re.sub(r"\s+", "", text)
    if compact in _SPURIOUS_DIRECTION_WORDS:
        return True
    if compact in _SPURIOUS_DIRECTION_DIGITS:
        return True
    if len(compact) <= 3 and compact.isdigit():
        return True
    return False


def _remove_spurious_directions(root: ET.Element, ns: str) -> int:
    removed = 0
    for part in root.findall(qname(ns, "part")):
        for measure in part.findall(qname(ns, "measure")):
            for direction in list(measure.findall(qname(ns, "direction"))):
                if _is_spurious_direction(direction, ns):
                    measure.remove(direction)
                    removed += 1
    return removed


def _remove_duplicate_staccato_as_natural(note: ET.Element, ns: str) -> bool:
    """가운데 점(늘임)이 제자리표로 중복 export된 경우 — natural만 제거."""
    notations = note.find(qname(ns, "notations"))
    if notations is None:
        return False
    articulations = notations.find(qname(ns, "articulations"))
    if articulations is None:
        return False
    staccatos = articulations.findall(qname(ns, "staccato"))
    if len(staccatos) < 2:
        return False
    acc = note.find(qname(ns, "accidental"))
    if acc is None or (acc.text or "").strip() != "natural":
        return False
    note.remove(acc)
    return True


def _fix_notes_in_part(part: ET.Element, ns: str) -> int:
    fixed = 0
    for measure in part.findall(qname(ns, "measure")):
        for note in measure.findall(qname(ns, "note")):
            if _remove_duplicate_staccato_as_natural(note, ns):
                fixed += 1
    return fixed


def fix_score_xml(xml_bytes: bytes) -> tuple[bytes, dict[str, int]]:
    tree = ET.parse(io.BytesIO(xml_bytes))
    root = tree.getroot()
    ns = mxl_ns_uri(root)
    stats = {
        "directions_removed": _remove_spurious_directions(root, ns),
        "natural_from_staccato_removed": 0,
    }
    for part in root.findall(qname(ns, "part")):
        stats["natural_from_staccato_removed"] += _fix_notes_in_part(part, ns)
    out = ET.tostring(root, encoding="UTF-8", xml_declaration=True)
    return out, stats


def fix_mxl_file(mxl_in: str | Path, mxl_out: str | Path) -> dict[str, int]:
    mxl_in = Path(mxl_in)
    mxl_out = Path(mxl_out)
    totals = {"directions_removed": 0, "natural_from_staccato_removed": 0}

    with zipfile.ZipFile(mxl_in, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    container_xml = files.get("META-INF/container.xml")
    if not container_xml:
        raise ValueError("Invalid MXL: no container.xml")

    container_str = container_xml.decode("utf-8")
    match = re.search(r'full-path="([^"]+)"', container_str)
    if not match:
        raise ValueError("Could not find rootfile in container.xml")
    root_path = match.group(1)

    fixed_xml, stats = fix_score_xml(files[root_path])
    for k, v in stats.items():
        totals[k] = totals.get(k, 0) + v
    files[root_path] = fixed_xml

    with zipfile.ZipFile(mxl_out, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, data in files.items():
            zout.writestr(name, data)

    return totals


def main() -> int:
    if len(sys.argv) < 3:
        print("Usage: python fix_audiveris_mxl.py <mxl_in> <mxl_out>", file=sys.stderr)
        return 2
    stats = fix_mxl_file(sys.argv[1], sys.argv[2])
    print(
        f"fix_audiveris_mxl: directions_removed={stats['directions_removed']} "
        f"natural_from_staccato_removed={stats['natural_from_staccato_removed']}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
