#!/usr/bin/env python3
"""MusicXML/MXL 악보 무관 품질 lint — phantom rest, 마디 경계 순서, spurious text 등.

Usage:
  python scripts/mxl_quality_lint.py score.mxl
  python scripts/mxl_quality_lint.py score.mxl --measure-offset 1 --json out.json
  python scripts/mxl_quality_lint.py score.mxl --page 3 --staff PL
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
from typing import Any

_STAFF_ORDER_6 = ("S", "A", "T", "B", "PR", "PL")
_SPURIOUS_WORDS = frozenset({"P", "p", "2P", "2p", "PR", "PL", "R", "L", "9"})
_TRAILING_REST_TYPES = frozenset({"eighth", "16th"})


def _ns(root: ET.Element) -> str:
    t = root.tag
    return t[1 : t.index("}")] if t.startswith("{") else ""


def _q(ns: str, local: str) -> str:
    return f"{{{ns}}}{local}" if ns else local


def _local(el: ET.Element) -> str:
    t = el.tag
    return t[t.index("}") + 1 :] if t.startswith("{") else t


def load_score_xml_from_mxl(mxl_path: Path) -> bytes:
    with zipfile.ZipFile(mxl_path, "r") as z:
        container = z.read("META-INF/container.xml").decode("utf-8")
        m = re.search(r'full-path="([^"]+)"', container)
        if not m:
            raise ValueError("container.xml에 rootfile 없음")
        return z.read(m.group(1))


def staff_label(part_index: int, part_count: int, part_name: str) -> str:
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
    ):
        if token in name:
            return label
    return f"P{part_index + 1}"


def printed_measure(mxl_number: str, offset: int) -> str | None:
    try:
        return str(int(mxl_number) + offset)
    except (TypeError, ValueError):
        return None


def estimate_page(measure_mxl: int, page_count: int, max_measure: int) -> int:
    if page_count < 1 or max_measure < 1:
        return 1
    per = max_measure / page_count
    return max(1, min(page_count, int((measure_mxl - 1) / per) + 1))


def _pitch_id(note: ET.Element, ns: str) -> str | None:
    if note.find(_q(ns, "rest")) is not None:
        typ = note.find(_q(ns, "type"))
        return f"rest:{(typ.text or '?').strip()}"
    pitch = note.find(_q(ns, "pitch"))
    if pitch is None:
        return None
    step = pitch.find(_q(ns, "step"))
    oct_el = pitch.find(_q(ns, "octave"))
    alt = pitch.find(_q(ns, "alter"))
    if step is None or oct_el is None:
        return None
    alter = int(alt.text) if alt is not None and alt.text else 0
    return f"{step.text}{alter}:{oct_el.text}"


def _measure_events(measure: ET.Element, ns: str) -> list[str]:
    """마디 내 음·쉼 순서(코드 음표는 한 덩어리로)."""
    events: list[str] = []
    chord_active = False
    for el in measure:
        tag = _local(el)
        if tag == "backup":
            chord_active = True
            continue
        if tag == "forward":
            chord_active = False
            continue
        if tag != "note":
            continue
        pid = _pitch_id(el, ns)
        if pid is None:
            continue
        if chord_active:
            if events:
                events[-1] = f"{events[-1]}+{pid}"
            else:
                events.append(pid)
        else:
            events.append(pid)
            chord_active = False
    return events


def _boundary_swap_suspect(tail: list[str], head: list[str]) -> bool:
    if len(tail) < 2 or len(head) < 2:
        return False
    if tail[-1] == head[0] and tail[0] == head[-1]:
        return True
    if len(tail) >= 2 and len(head) >= 2:
        if tail[-2:] == head[:2][::-1] or tail[-1:] + tail[-2:-3:-1] == head[:2]:
            return True
    return False


def lint_score_xml(
    xml_bytes: bytes,
    *,
    measure_offset_printed: int = 1,
    page_count: int = 1,
) -> dict[str, Any]:
    root = ET.parse(io.BytesIO(xml_bytes)).getroot()
    ns = _ns(root)

    parts_meta: list[dict[str, str]] = []
    for sp in root.findall(f".//{_q(ns, 'score-part')}"):
        pid = sp.get("id", "")
        pn = sp.find(_q(ns, "part-name"))
        parts_meta.append(
            {
                "id": pid,
                "name": (pn.text or "").strip() if pn is not None else "",
            }
        )
    part_count = len(parts_meta)

    spurious_directions: list[dict] = []
    trailing_phantom_rests: list[dict] = []
    boundary_order_suspects: list[dict] = []
    tuplet_starts = 0
    max_mxl_measure = 0

    per_part_measures: list[list[tuple[str, list[str]]]] = []

    for part_index, part in enumerate(root.findall(_q(ns, "part"))):
        pid = part.get("id", "")
        pname = parts_meta[part_index]["name"] if part_index < len(parts_meta) else ""
        staff = staff_label(part_index, part_count, pname)
        seq_by_measure: list[tuple[str, list[str]]] = []

        for measure in part.findall(_q(ns, "measure")):
            mnum = measure.get("number", "?")
            if mnum.isdigit():
                max_mxl_measure = max(max_mxl_measure, int(mnum))
            printed = printed_measure(mnum, measure_offset_printed)
            page_est = (
                estimate_page(int(mnum), page_count, max_mxl_measure)
                if mnum.isdigit()
                else 1
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
                            "code": "spuriousDirection",
                            "staff": staff,
                            "partId": pid,
                            "measureMxl": mnum,
                            "measurePrinted": printed,
                            "pageEstimate": page_est,
                            "detail": compact,
                        }
                    )

            events = _measure_events(measure, ns)
            seq_by_measure.append((mnum, events))

            if len(events) >= 2 and events[-1].startswith("rest:"):
                rest_type = events[-1].split(":", 1)[1]
                if rest_type in _TRAILING_REST_TYPES and any(
                    not e.startswith("rest:") for e in events[:-1]
                ):
                    trailing_phantom_rests.append(
                        {
                            "code": "trailingPhantomRest",
                            "staff": staff,
                            "partId": pid,
                            "measureMxl": mnum,
                            "measurePrinted": printed,
                            "pageEstimate": page_est,
                            "detail": rest_type,
                        }
                    )

            for note in measure.findall(_q(ns, "note")):
                notations = note.find(_q(ns, "notations"))
                if notations is None:
                    continue
                for tup in notations.findall(_q(ns, "tuplet")):
                    if tup.get("type") != "stop":
                        tuplet_starts += 1

        for i in range(len(seq_by_measure) - 1):
            m_a, ev_a = seq_by_measure[i]
            m_b, ev_b = seq_by_measure[i + 1]
            tail = [e for e in ev_a if not e.startswith("rest:")][-4:]
            head = [e for e in ev_b if not e.startswith("rest:")][:4]
            if _boundary_swap_suspect(tail, head):
                pa = printed_measure(m_a, measure_offset_printed)
                pb = printed_measure(m_b, measure_offset_printed)
                boundary_order_suspects.append(
                    {
                        "code": "measureBoundaryOrderSuspect",
                        "staff": staff,
                        "partId": pid,
                        "measureMxlA": m_a,
                        "measureMxlB": m_b,
                        "measurePrintedA": pa,
                        "measurePrintedB": pb,
                        "pageEstimate": estimate_page(
                            int(m_b) if m_b.isdigit() else 1,
                            page_count,
                            max_mxl_measure,
                        ),
                        "detail": f"tail={tail[-2:]} head={head[:2]}",
                    }
                )
        per_part_measures.append(seq_by_measure)

    issues = (
        spurious_directions
        + trailing_phantom_rests
        + boundary_order_suspects
    )

    by_page_staff: dict[str, int] = {}
    for iss in issues:
        key = f"p{iss.get('pageEstimate', 1)}:{iss.get('staff', '?')}"
        by_page_staff[key] = by_page_staff.get(key, 0) + 1

    return {
        "measureOffsetPrinted": measure_offset_printed,
        "pageCount": page_count,
        "maxMeasureMxl": max_mxl_measure,
        "parts": parts_meta,
        "staffOrderHint": list(_STAFF_ORDER_6) if part_count == 6 else None,
        "issueCount": len(issues),
        "issues": issues,
        "summary": {
            "spuriousDirection": len(spurious_directions),
            "trailingPhantomRest": len(trailing_phantom_rests),
            "measureBoundaryOrderSuspect": len(boundary_order_suspects),
            "tupletStartTags": tuplet_starts,
        },
        "byPageStaff": [
            {"key": k, "count": v} for k, v in sorted(by_page_staff.items())
        ],
        "pCauses": [
            "TEXTS(OCR)가 SYMBOLS 글리프를 선점 — Audiveris TextWord·OCR eng",
            "다성부 세로 정렬로 tuplet 숫자가 한 staff에만 붙음 — SYMBOLS/BEAMS",
            "마디 끝 8분 쉼표 — RHYTHMS 마디 채우기(heuristic)",
            "마디 경계 음 순서 — LINKS/RHYTHMS(heuristic)",
        ],
    }


def lint_mxl_file(
    mxl_path: Path,
    *,
    measure_offset_printed: int = 1,
    page_count: int = 1,
) -> dict[str, Any]:
    xml = load_score_xml_from_mxl(mxl_path)
    report = lint_score_xml(
        xml,
        measure_offset_printed=measure_offset_printed,
        page_count=page_count,
    )
    report["mxl"] = str(mxl_path)
    return report


def filter_report(
    report: dict[str, Any],
    *,
    page: int | None = None,
    staff: str | None = None,
) -> dict[str, Any]:
    issues = report.get("issues") or []
    if page is not None:
        issues = [i for i in issues if i.get("pageEstimate") == page]
    if staff:
        issues = [i for i in issues if i.get("staff") == staff]
    out = dict(report)
    out["issues"] = issues
    out["issueCount"] = len(issues)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="MXL 악보 무관 품질 lint")
    ap.add_argument("mxl", type=Path)
    ap.add_argument("--measure-offset", type=int, default=1)
    ap.add_argument("--page-count", type=int, default=1)
    ap.add_argument("--page", type=int, default=None)
    ap.add_argument("--staff", type=str, default=None)
    ap.add_argument("--json", type=Path, default=None)
    args = ap.parse_args()
    if not args.mxl.is_file():
        print(f"파일 없음: {args.mxl}", file=sys.stderr)
        return 2
    report = lint_mxl_file(
        args.mxl,
        measure_offset_printed=args.measure_offset,
        page_count=max(1, args.page_count),
    )
    if args.page is not None or args.staff:
        report = filter_report(report, page=args.page, staff=args.staff)
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.json:
        args.json.write_text(text, encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
