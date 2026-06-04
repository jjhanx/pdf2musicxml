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

# 인쇄 마디·페이지 기준 사용자 보고 위치 (docs/합창_피아노_SYMBOLS_오인식_대조.md)
_REGRESSION_SPOTS: list[dict] = [
    {"page": 3, "staff": "PL", "measurePrinted": "15", "expectTuplet": True},
    {"page": 4, "staff": "PR", "measurePrinted": "22"},
    {"page": 4, "staff": "PR", "measurePrinted": "23"},
    {"page": 5, "staff": "PL", "measurePrinted": "29", "expectTuplet": True},
    {"page": 7, "staff": "PL", "measurePrinted": "40", "expectTuplet": True},
    {"page": 7, "staff": "PL", "measurePrinted": "41", "expectTuplet": True},
    {"page": 7, "staff": "PL", "measurePrinted": "45", "expectTuplet": True, "suspectQuarter": True},
    {"page": 10, "staff": "PR", "measurePrinted": "61", "expectTuplet": True},
]


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


def _mxl_measure_from_printed(printed: str, offset: int) -> str | None:
    try:
        return str(int(printed) - offset)
    except (TypeError, ValueError):
        return None


def _measure_key(staff: str, printed: str | None) -> str | None:
    if not printed:
        return None
    return f"{staff}:{printed}"


def _run_regression_checks(
    measure_stats: dict[str, dict],
    spurious_by_measure: dict[str, int],
    *,
    measure_offset_printed: int,
) -> list[dict]:
    out: list[dict] = []
    for spot in _REGRESSION_SPOTS:
        staff = spot["staff"]
        printed = spot["measurePrinted"]
        key = _measure_key(staff, printed)
        mxl = _mxl_measure_from_printed(printed, measure_offset_printed)
        st = measure_stats.get(key or "", {})
        issues: list[str] = []
        if spot.get("expectTuplet") and st.get("tupletStarts", 0) == 0:
            issues.append("missingTupletInMxl")
        if spot.get("suspectQuarter"):
            q = st.get("quarterNotes", 0)
            if q >= 4 and st.get("tupletStarts", 0) == 0:
                issues.append("possibleTripletAsQuarter")
        if key and spurious_by_measure.get(key, 0) > 0:
            issues.append("spuriousPInMxl")
        out.append(
            {
                "page": spot.get("page"),
                "staff": staff,
                "measurePrinted": printed,
                "measureMxl": mxl,
                "pitchNotes": st.get("pitchNotes", 0),
                "tupletStarts": st.get("tupletStarts", 0),
                "quarterNotes": st.get("quarterNotes", 0),
                "eighthNotes": st.get("eighthNotes", 0),
                "spuriousP": spurious_by_measure.get(key or "", 0),
                "issues": issues,
                "ok": len(issues) == 0,
            }
        )
    return out


def scan_mxl(
    mxl_path: Path,
    *,
    measure_offset_printed: int = 1,
    regression: bool = False,
) -> dict:
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
    measure_stats: dict[str, dict] = {}
    spurious_by_measure: dict[str, int] = {}

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
            mkey = _measure_key(staff, printed)
            if mkey:
                measure_stats.setdefault(
                    mkey,
                    {
                        "pitchNotes": 0,
                        "tupletStarts": 0,
                        "quarterNotes": 0,
                        "eighthNotes": 0,
                    },
                )

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
                    if mkey:
                        spurious_by_measure[mkey] = spurious_by_measure.get(mkey, 0) + 1

            for note in measure.findall(_q(ns, "note")):
                if note.find(_q(ns, "rest")) is not None:
                    continue
                if mkey:
                    measure_stats[mkey]["pitchNotes"] += 1
                dur = note.find(_q(ns, "type"))
                if mkey and dur is not None and dur.text:
                    if dur.text == "quarter":
                        measure_stats[mkey]["quarterNotes"] += 1
                    elif dur.text == "eighth":
                        measure_stats[mkey]["eighthNotes"] += 1
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
                            if mkey:
                                measure_stats[mkey]["tupletStarts"] += 1
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

    report: dict = {
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
            "이음줄·순서·세잇단 괄호선·PR/PL 3 공유는 MXL 후처리로 복구 어려움",
            "보고 마디 대조: --regression",
        ],
    }
    if regression:
        checks = _run_regression_checks(
            measure_stats, spurious_by_measure, measure_offset_printed=measure_offset_printed
        )
        report["regressionChecks"] = checks
        report["regressionFailed"] = sum(1 for c in checks if not c["ok"])
    return report


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
    ap.add_argument(
        "--regression",
        action="store_true",
        help="docs 합창·피아노 보고 마디(15,29,40,41,45,61 등) MXL 자동 대조",
    )
    args = ap.parse_args()
    if not args.mxl.is_file():
        print(f"파일 없음: {args.mxl}", file=sys.stderr)
        return 2
    report = scan_mxl(
        args.mxl,
        measure_offset_printed=args.measure_offset,
        regression=args.regression,
    )
    if args.json:
        args.json.write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
