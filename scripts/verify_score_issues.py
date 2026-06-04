#!/usr/bin/env python3
"""Audiveris MXL에서 흔한 오인식 패턴을 스캔 (사용자 보고 위치 대조용).

Usage:
  python scripts/verify_score_issues.py path/to/score.mxl
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


def scan_mxl(mxl_path: Path) -> dict:
    root = ET.parse(io.BytesIO(_load_score_xml(mxl_path))).getroot()
    ns = _ns(root)

    parts_meta: list[dict] = []
    for sp in root.findall(f".//{_q(ns, 'score-part')}"):
        pid = sp.get("id", "")
        name_el = sp.find(_q(ns, "part-name"))
        parts_meta.append(
            {
                "id": pid,
                "name": (name_el.text or "").strip() if name_el is not None else "",
            }
        )

    spurious_directions: list[dict] = []
    suspicious_accidentals: list[dict] = []
    staccato_natural: list[dict] = []
    tuplet_count = 0
    measure_count = 0

    for part in root.findall(_q(ns, "part")):
        pid = part.get("id", "")
        for measure in part.findall(_q(ns, "measure")):
            mnum = measure.get("number", "?")
            measure_count += 1
            for direction in measure.findall(_q(ns, "direction")):
                texts: list[str] = []
                for el in direction.iter():
                    if _local(el) in ("words", "text"):
                        if el.text and el.text.strip():
                            texts.append(el.text.strip())
                compact = re.sub(r"\s+", "", " ".join(texts))
                if compact in _SPURIOUS_WORDS or (len(compact) <= 3 and compact.isdigit()):
                    spurious_directions.append(
                        {"partId": pid, "measure": mnum, "text": compact}
                    )
            for note in measure.findall(_q(ns, "note")):
                if note.find(_q(ns, "rest")) is not None:
                    continue
                acc = note.find(_q(ns, "accidental"))
                if acc is not None and (acc.text or "").strip() in ("natural", "sharp", "flat"):
                    suspicious_accidentals.append(
                        {
                            "partId": pid,
                            "measure": mnum,
                            "accidental": (acc.text or "").strip(),
                        }
                    )
                notations = note.find(_q(ns, "notations"))
                if notations is not None:
                    arts = notations.find(_q(ns, "articulations"))
                    if arts is not None:
                        st = arts.findall(_q(ns, "staccato"))
                        if len(st) >= 2 and acc is not None and (acc.text or "").strip() == "natural":
                            staccato_natural.append({"partId": pid, "measure": mnum})
                    for tup in notations.findall(_q(ns, "tuplet")):
                        if tup.get("type") != "stop":
                            tuplet_count += 1

    return {
        "mxl": str(mxl_path),
        "parts": parts_meta,
        "measureCount": measure_count,
        "tupletStartTags": tuplet_count,
        "spuriousDirections": spurious_directions,
        "suspiciousAccidentalNotes": suspicious_accidentals[:200],
        "staccatoWithNatural": staccato_natural,
        "hints": [
            "spuriousDirections: TEXTS/OCR·성부약어 잔여 — clean_score 왼쪽 마스킹·AUDIVERIS OCR eng·TextWord 상수 확인",
            "SYMBOLS UI만 문제면 fix_audiveris_mxl은 도움 안 됨 — Audiveris -constant 또는 소스 패치",
            "partId↔S/A/T/B/PR/PL은 part-name·순서로 수동 매핑 후 measure 번호와 대조",
        ],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="MXL Audiveris 오인식 패턴 스캔")
    ap.add_argument("mxl", type=Path)
    ap.add_argument("--json", type=Path, help="JSON 보고서 저장")
    args = ap.parse_args()
    if not args.mxl.is_file():
        print(f"파일 없음: {args.mxl}", file=sys.stderr)
        return 2
    report = scan_mxl(args.mxl)
    if args.json:
        args.json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
