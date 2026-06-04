#!/usr/bin/env python3
"""Audiveris MXL 오인식 패턴 스캔 — 합창+피아노(S/A/T/B/PR/PL) 보고 형식 대조.

Usage:
  python scripts/verify_score_issues.py path/to/score.mxl
  python scripts/verify_score_issues.py path/to/score.mxl --measure-offset 1
  python scripts/verify_score_issues.py path/to/score.mxl --json report.json
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

_STAFF_ORDER_6 = ("S", "A", "T", "B", "PR", "PL")
_SPURIOUS_WORDS = frozenset({"P", "p", "2P", "2p", "PR", "PL", "R", "L", "9"})


def _ns(root: ET.Element) -> str:
    t = root.tag
    return t[1 : t.index("}")] if t.startswith("{") else ""


def _q(ns: str, local: str) -> str:
    return f"{{{ns}}}{local}" if ns else local


def _local(el: ET.Element) -> str:
    t = el.tag
    return t[t.index("}") + 1 :] if t.startswith("{") else t


def _load_score_xml(mxl_path: Path) -> bytes:
    with zipfile.ZipFile(mxl_path, "r") as z:
        container = z.read("META-INF/container.xml").decode("utf-8")
        m = re.search(r'full-path="([^"]+)"', container)
        if not m:
            raise ValueError("container.xml에 rootfile 없음")
        return z.read(m.group(1))


def _staff_label(part_index: int, part_count: int, part_name: str) -> str:
    if part_count == 6 and 0 <= part_index < 6:
        return _STAFF_ORDER_6[part_index]
    name = (part_name or "").upper()
    for token, label in (
        ("SOPRANO", "S"),
        ("ALTO", "A"),
        ("TENOR", "T"),
        ("BASS", "B"),
        ("RIGHT", "PR"),
        ("LEFT", "PL"),
        ("PIANO", "P"),
    ):
        if token in name:
            return label
    return f"P{part_index + 1}"


def _printed_measure(mxl_number: str, offset: int) -> str | None:
    try:
        return str(int(mxl_number) + offset)
    except (TypeError, ValueError):
        return None


def scan_mxl(mxl_path: Path, *, measure_offset_printed: int = 1) -> dict:
    root = ET.parse(io.BytesIO(_load_score_xml(mxl_path))).getroot()
    ns = _ns(root)

    parts_meta: list[dict] = []
    part_ids: list[str] = []
    for sp in root.findall(f".//{_q(ns, 'score-part')}"):
        pid = sp.get("id", "")
        name_el = sp.find(_q(ns, "part-name"))
        parts_meta.append(
            {
                "id": pid,
                "name": (name_el.text or "").strip() if name_el is not None else "",
            }
        )
        part_ids.append(pid)

    part_count = len(part_ids)
    spurious_directions: list[dict] = []
    suspicious_accidentals: list[dict] = []
    staccato_natural: list[dict] = []
    tuplet_start = 0
    tuplet_stop = 0
    tie_start = 0
    tie_stop = 0
    measure_numbers: list[str] = []

    for part_index, part in enumerate(root.findall(_q(ns, "part"))):
        pid = part.get("id", "")
        pname = ""
        for pm in parts_meta:
            if pm["id"] == pid:
                pname = pm["name"]
                break
        staff = _staff_label(part_index, part_count, pname)

        for measure in part.findall(_q(ns, "measure")):
            mnum = measure.get("number", "?")
            measure_numbers.append(mnum)
            printed = _printed_measure(mnum, measure_offset_printed)

            for direction in measure.findall(_q(ns, "direction")):
                texts: list[str] = []
                for el in direction.iter():
                    if _local(el) in ("words", "text", "syllable"):
                        if el.text and el.text.strip():
                            texts.append(el.text.strip())
                compact = re.sub(r"\s+", "", " ".join(texts))
                if compact in _SPURIOUS_WORDS or (
                    len(compact) <= 3 and compact.isdigit()
                ) or re.fullmatch(r"[Pp]{1,3}", compact or ""):
                    spurious_directions.append(
                        {
                            "staff": staff,
                            "partId": pid,
                            "measureMxl": mnum,
                            "measurePrinted": printed,
                            "text": compact,
                        }
                    )

            for note in measure.findall(_q(ns, "note")):
                if note.find(_q(ns, "rest")) is not None:
                    continue
                acc = note.find(_q(ns, "accidental"))
                if acc is not None and (acc.text or "").strip() in (
                    "natural",
                    "sharp",
                    "flat",
                ):
                    suspicious_accidentals.append(
                        {
                            "staff": staff,
                            "partId": pid,
                            "measureMxl": mnum,
                            "measurePrinted": printed,
                            "accidental": (acc.text or "").strip(),
                        }
                    )
                notations = note.find(_q(ns, "notations"))
                if notations is not None:
                    arts = notations.find(_q(ns, "articulations"))
                    if arts is not None:
                        st = arts.findall(_q(ns, "staccato"))
                        if (
                            len(st) >= 2
                            and acc is not None
                            and (acc.text or "").strip() == "natural"
                        ):
                            staccato_natural.append(
                                {
                                    "staff": staff,
                                    "measureMxl": mnum,
                                    "measurePrinted": printed,
                                }
                            )
                    for tup in notations.findall(_q(ns, "tuplet")):
                        if tup.get("type") == "stop":
                            tuplet_stop += 1
                        else:
                            tuplet_start += 1
                    tied = note.find(_q(ns, "tie"))
                    if tied is not None:
                        t = tied.get("type", "start")
                        if t == "stop":
                            tie_stop += 1
                        else:
                            tie_start += 1

    unique_measures = sorted(
        {m for m in measure_numbers if m.isdigit()},
        key=lambda x: int(x),
    )

    return {
        "mxl": str(mxl_path),
        "parts": parts_meta,
        "staffOrderHint": list(_STAFF_ORDER_6) if part_count == 6 else None,
        "measureOffsetPrinted": measure_offset_printed,
        "measureOffsetNote": "인쇄 마디 ≈ measureMxl + offset (pickup 시 흔히 1)",
        "mxlMeasureNumbersSample": unique_measures[:20],
        "tupletStartTags": tuplet_start,
        "tupletStopTags": tuplet_stop,
        "tieStartTags": tie_start,
        "tieStopTags": tie_stop,
        "spuriousDirections": spurious_directions,
        "spuriousDirectionCount": len(spurious_directions),
        "suspiciousAccidentalNotes": suspicious_accidentals[:200],
        "staccatoWithNatural": staccato_natural,
        "checklistDoc": "docs/합창_피아노_SYMBOLS_오인식_대조.md",
        "hints": [
            "spuriousDirections>0: fix_audiveris_mxl·AUDIVERIS OCR eng·TextWord 상수 확인",
            "SYMBOLS에만 P가 보이고 MXL에 없으면 Audiveris 패치/development 빌드",
            "이음줄·순서·세잇단 괄호선은 MXL 후처리로 복구 어려움",
        ],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="MXL Audiveris 오인식 패턴 스캔")
    ap.add_argument("mxl", type=Path)
    ap.add_argument(
        "--measure-offset",
        type=int,
        default=1,
        help="인쇄 마디 = MXL measure number + 이 값 (기본 1)",
    )
    ap.add_argument("--json", type=Path, help="JSON 보고서 저장")
    args = ap.parse_args()
    if not args.mxl.is_file():
        print(f"파일 없음: {args.mxl}", file=sys.stderr)
        return 2
    report = scan_mxl(args.mxl, measure_offset_printed=args.measure_offset)
    if args.json:
        args.json.write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
