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

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

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


def staff_label(
    part_index: int,
    part_count: int,
    part_name: str,
    labels_by_index: list[str] | None = None,
    instrument_name: str = "",
) -> str:
    if labels_by_index and 0 <= part_index < len(labels_by_index):
        custom = (labels_by_index[part_index] or "").strip()
        if custom:
            return custom
    name = f"{part_name or ''} {instrument_name or ''}".upper()
    if "LEFT" in name or " LH" in name or name.endswith(" LH"):
        return "PL"
    if "RIGHT" in name or " RH" in name or name.endswith(" RH"):
        return "PR"
    if "PIANO" in name or "PNO" in name:
        return "P"
    if part_count == 6 and 0 <= part_index < 6 and "PIANO" not in name and "PNO" not in name:
        return _STAFF_ORDER_6[part_index]
    for token, label in (
        ("SOPRANO", "S"),
        ("ALTO", "A"),
        ("TENOR", "T"),
        ("BASS", "B"),
    ):
        if token in name:
            return label
    return f"P{part_index + 1}"


def load_part_labels_json(path: Path | None) -> list[str] | None:
    if path is None or not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if isinstance(data, dict) and isinstance(data.get("labelsByIndex"), list):
        return [str(x).strip() for x in data["labelsByIndex"]]
    return None


def list_score_parts_from_xml(xml_bytes: bytes) -> list[dict[str, Any]]:
    root = ET.parse(io.BytesIO(xml_bytes)).getroot()
    ns = _ns(root)
    parts_meta: list[dict[str, str]] = []
    for sp in root.findall(f".//{_q(ns, 'score-part')}"):
        pid = sp.get("id", "")
        pn = sp.find(_q(ns, "part-name"))
        instrument = ""
        for si in sp.findall(_q(ns, "score-instrument")):
            in_el = si.find(_q(ns, "instrument-name"))
            if in_el is not None and in_el.text and in_el.text.strip():
                instrument = in_el.text.strip()
                break
        parts_meta.append(
            {
                "id": pid,
                "name": (pn.text or "").strip() if pn is not None else "",
                "instrumentName": instrument,
            }
        )
    part_count = len(parts_meta)
    out: list[dict[str, Any]] = []
    for i, meta in enumerate(parts_meta):
        suggested = staff_label(i, part_count, meta["name"], instrument_name=meta["instrumentName"])
        out.append(
            {
                "index": i,
                "partIndex": i + 1,
                "id": meta["id"],
                "name": meta["name"],
                "instrumentName": meta["instrumentName"],
                "suggestedLabel": suggested,
            }
        )
    return out


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
        rest_type = (typ.text or "?").strip() if typ is not None else "?"
        return f"rest:{rest_type}"
    pitch = note.find(_q(ns, "pitch"))
    if pitch is None:
        return None
    step = pitch.find(_q(ns, "step"))
    oct_el = pitch.find(_q(ns, "octave"))
    alt = pitch.find(_q(ns, "alter"))
    if step is None or oct_el is None or not step.text or not oct_el.text:
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


def _note_type(note: ET.Element, ns: str) -> str:
    typ = note.find(_q(ns, "type"))
    return (typ.text or "").strip() if typ is not None and typ.text else ""


def _note_duration(note: ET.Element, ns: str) -> int:
    dur_el = note.find(_q(ns, "duration"))
    if dur_el is None or not dur_el.text or not dur_el.text.strip().isdigit():
        return 0
    return int(dur_el.text.strip())


def _note_beams(note: ET.Element, ns: str) -> list[str]:
    return [b.text for b in note.findall(_q(ns, "beam")) if b.text]


def _is_rest_note(note: ET.Element, ns: str) -> bool:
    return note.find(_q(ns, "rest")) is not None


def _chord_pitch_set(notes: list[ET.Element], ns: str) -> set[str]:
    out: set[str] = set()
    for n in notes:
        pid = _pitch_id(n, ns)
        if pid and not pid.startswith("rest:"):
            out.add(pid)
    return out


def _iter_chord_groups(measure: ET.Element, ns: str) -> list[dict[str, Any]]:
    """마디 내 코드·단음 그룹(문서 순서)."""
    groups: list[dict[str, Any]] = []
    for el in measure:
        if _local(el) != "note":
            continue
        note = el
        if note.find(_q(ns, "grace")) is not None:
            continue
        staff_el = note.find(_q(ns, "staff"))
        voice_el = note.find(_q(ns, "voice"))
        staff = (staff_el.text or "1").strip() if staff_el is not None else "1"
        voice = (voice_el.text or "1").strip() if voice_el is not None else "1"
        if note.find(_q(ns, "chord")) is not None and groups:
            g = groups[-1]
            if g["staff"] == staff and g["voice"] == voice:
                g["notes"].append(note)
                continue
        groups.append(
            {
                "leader": note,
                "notes": [note],
                "staff": staff,
                "voice": voice,
                "type": _note_type(note, ns),
                "duration": _note_duration(note, ns),
                "beams": _note_beams(note, ns),
                "rest": _is_rest_note(note, ns),
                "pitches": _chord_pitch_set([note], ns),
            }
        )
    for g in groups:
        g["pitches"] = _chord_pitch_set(g["notes"], ns)
    return groups


def _detect_rhythm_suspects(groups: list[dict[str, Any]]) -> list[tuple[str, str]]:
    """Audiveris RHYTHMS 흔한 오인 — 자동 수정 없이 HITL 표시만."""
    out: list[tuple[str, str]] = []
    for i in range(len(groups) - 1):
        g0, g1 = groups[i], groups[i + 1]
        if g0["staff"] != g1["staff"] or g0["voice"] != g1["voice"]:
            continue
        if g0["rest"] or g1["rest"]:
            continue
        if (
            g0["type"] == "quarter"
            and not g0["beams"]
            and g1["beams"]
            and g0["pitches"]
            and g0["pitches"] & g1["pitches"]
        ):
            out.append(
                (
                    "rhythmQuarterBeforeBeamedEighth",
                    f"4분(빔 없음) 직후 빔 8분·동일 음정 — Audiveris RHYTHMS 오인 의심",
                )
            )
    for i in range(len(groups) - 3):
        g0, g1, g2, g3 = groups[i], groups[i + 1], groups[i + 2], groups[i + 3]
        if not (g0["staff"] == g1["staff"] == g2["staff"] == g3["staff"]):
            continue
        if not (g0["voice"] == g1["voice"] == g2["voice"] == g3["voice"]):
            continue
        if any(g["rest"] for g in (g0, g1, g2, g3)):
            continue
        if (
            g0["type"] == "quarter"
            and g1["type"] == "quarter"
            and not g0["beams"]
            and not g1["beams"]
            and "begin" in g2["beams"]
            and "end" in g3["beams"]
            and g2["type"] == "eighth"
            and g3["type"] == "eighth"
        ):
            out.append(
                (
                    "rhythmPlainQuarterPairBeforeBeams",
                    "빔 없는 4분 2개 직후 빔 8분 2개 — 빔 8분화음→4분화음 오인 의심",
                )
            )
    return out


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
    labels_by_index: list[str] | None = None,
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

    max_mxl_measure = 0
    for part in root.findall(_q(ns, "part")):
        for measure in part.findall(_q(ns, "measure")):
            mnum = measure.get("number", "?")
            if mnum.isdigit():
                max_mxl_measure = max(max_mxl_measure, int(mnum))
    if max_mxl_measure < 1:
        max_mxl_measure = 1

    spurious_directions: list[dict] = []
    trailing_phantom_rests: list[dict] = []
    rest_staff_issues: list[dict] = []
    rest_display_high_issues: list[dict] = []
    boundary_order_suspects: list[dict] = []
    underfull_measures: list[dict] = []
    overfull_measures: list[dict] = []
    rhythm_suspects: list[dict] = []
    tuplet_starts = 0

    per_part_measures: list[list[tuple[str, list[str]]]] = []

    for part_index, part in enumerate(root.findall(_q(ns, "part"))):
        pid = part.get("id", "")
        pname = parts_meta[part_index]["name"] if part_index < len(parts_meta) else ""
        staff = staff_label(part_index, part_count, pname, labels_by_index)
        seq_by_measure: list[tuple[str, list[str]]] = []

        divisions = 1
        beats = 4
        beat_type = 4

        for measure in part.findall(_q(ns, "measure")):
            mnum = measure.get("number", "?")
            printed = printed_measure(mnum, measure_offset_printed)
            page_est = (
                estimate_page(int(mnum), page_count, max_mxl_measure)
                if mnum.isdigit()
                else 1
            )

            # attributes 추적
            for attr in measure.findall(_q(ns, "attributes")):
                div_el = attr.find(_q(ns, "divisions"))
                if div_el is not None and div_el.text and div_el.text.strip().isdigit():
                    divisions = max(1, int(div_el.text.strip()))
                time_el = attr.find(_q(ns, "time"))
                if time_el is not None:
                    b_el = time_el.find(_q(ns, "beats"))
                    bt_el = time_el.find(_q(ns, "beat-type"))
                    try:
                        if b_el is not None and b_el.text and b_el.text.strip():
                            beats = max(1, int(b_el.text.strip()))
                        if bt_el is not None and bt_el.text and bt_el.text.strip():
                            beat_type = max(1, int(bt_el.text.strip()))
                    except ValueError:
                        pass

            is_implicit = measure.get("implicit") == "yes"

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

            note_els = [el for el in measure if _local(el) == "note"]

            # 보이스별 박자(duration) 검증
            if not is_implicit:
                measure_len = max(1, round(divisions * beats * 4 / beat_type))
                by_voice: dict[str, int] = {}
                for note in note_els:
                    if note.find(_q(ns, "grace")) is not None:
                        continue
                    if note.find(_q(ns, "chord")) is not None:
                        continue
                    voice_el = note.find(_q(ns, "voice"))
                    voice = (voice_el.text or "1").strip() if voice_el is not None and voice_el.text else "1"

                    dur_el = note.find(_q(ns, "duration"))
                    dur = 0
                    if dur_el is not None and dur_el.text and dur_el.text.strip().isdigit():
                        dur = int(dur_el.text.strip())
                    by_voice[voice] = by_voice.get(voice, 0) + dur

                for voice, total_dur in by_voice.items():
                    if total_dur < measure_len:
                        underfull_measures.append(
                            {
                                "code": "measureUnderfull",
                                "staff": staff,
                                "partId": pid,
                                "measureMxl": mnum,
                                "measurePrinted": printed,
                                "pageEstimate": page_est,
                                "detail": f"Voice {voice}: {total_dur}/{measure_len} (박자 부족)",
                                "voice": voice,
                                "totalDur": total_dur,
                                "expectedDur": measure_len,
                            }
                        )
                    elif total_dur > measure_len:
                        overfull_measures.append(
                            {
                                "code": "measureOverfull",
                                "staff": staff,
                                "partId": pid,
                                "measureMxl": mnum,
                                "measurePrinted": printed,
                                "pageEstimate": page_est,
                                "detail": f"Voice {voice}: {total_dur}/{measure_len} (박자 초과)",
                                "voice": voice,
                                "totalDur": total_dur,
                                "expectedDur": measure_len,
                            }
                        )

            groups = _iter_chord_groups(measure, ns)
            for code, detail in _detect_rhythm_suspects(groups):
                rhythm_suspects.append(
                    {
                        "code": code,
                        "staff": staff,
                        "partId": pid,
                        "measureMxl": mnum,
                        "measurePrinted": printed,
                        "pageEstimate": page_est,
                        "detail": detail,
                    }
                )

            if len(events) >= 2 and events[-1].startswith("rest:"):
                rest_type = events[-1].split(":", 1)[1]
                if rest_type in _TRAILING_REST_TYPES and any(
                    not e.startswith("rest:") for e in events[:-1]
                ):
                    trail_idx = None
                    for ri in range(len(note_els) - 1, -1, -1):
                        n = note_els[ri]
                        if n.find(_q(ns, "rest")) is None:
                            continue
                        typ = n.find(_q(ns, "type"))
                        tval = (typ.text or "").strip() if typ is not None and typ.text else ""
                        if tval == rest_type:
                            trail_idx = ri
                            break
                    trailing_phantom_rests.append(
                        {
                            "code": "trailingPhantomRest",
                            "staff": staff,
                            "partId": pid,
                            "measureMxl": mnum,
                            "measurePrinted": printed,
                            "pageEstimate": page_est,
                            "detail": rest_type,
                            "noteIndex": trail_idx,
                        }
                    )

            staffs_in_measure: set[int] = set()
            for note in note_els:
                st_el = note.find(_q(ns, "staff"))
                if st_el is not None and st_el.text and st_el.text.isdigit():
                    staffs_in_measure.add(int(st_el.text))
            max_staff = max(staffs_in_measure) if staffs_in_measure else 1

            for ni, note in enumerate(note_els):
                rest_el = note.find(_q(ns, "rest"))
                if rest_el is None:
                    continue
                st_el = note.find(_q(ns, "staff"))
                has_staff = (
                    st_el is not None and st_el.text and st_el.text.strip().isdigit()
                )
                if max_staff >= 2 and not has_staff:
                    rest_staff_issues.append(
                        {
                            "code": "restMissingStaff",
                            "staff": staff,
                            "partId": pid,
                            "measureMxl": mnum,
                            "measurePrinted": printed,
                            "pageEstimate": page_est,
                            "detail": f"staff→{max_staff}",
                            "noteIndex": ni,
                            "suggestedStaff": max_staff,
                        }
                    )
                typ = note.find(_q(ns, "type"))
                tval = (typ.text or "").strip() if typ is not None and typ.text else ""
                ds = rest_el.find(_q(ns, "display-step"))
                step = (ds.text or "").strip().upper() if ds is not None and ds.text else ""
                if tval in ("whole", "half") and step in ("C", "D", "E"):
                    rest_display_high_issues.append(
                        {
                            "code": "restDisplayHigh",
                            "staff": staff,
                            "partId": pid,
                            "measureMxl": mnum,
                            "measurePrinted": printed,
                            "pageEstimate": page_est,
                            "detail": f"{tval}:{step}",
                            "noteIndex": ni,
                            "suggestedLineDelta": 1,
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
        + rest_staff_issues
        + rest_display_high_issues
        + boundary_order_suspects
        + underfull_measures
        + overfull_measures
        + rhythm_suspects
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
        "staffOrderHint": labels_by_index
        if labels_by_index
        else (list(_STAFF_ORDER_6) if part_count == 6 else None),
        "partLabelsByIndex": labels_by_index,
        "staffsInIssues": sorted(
            {str(iss.get("staff")) for iss in issues if iss.get("staff")}
        ),
        "issueCount": len(issues),
        "issues": issues,
        "summary": {
            "spuriousDirection": len(spurious_directions),
            "trailingPhantomRest": len(trailing_phantom_rests),
            "restMissingStaff": len(rest_staff_issues),
            "restDisplayHigh": len(rest_display_high_issues),
            "measureBoundaryOrderSuspect": len(boundary_order_suspects),
            "measureUnderfull": len(underfull_measures),
            "measureOverfull": len(overfull_measures),
            "rhythmQuarterBeforeBeamedEighth": sum(
                1 for x in rhythm_suspects if x["code"] == "rhythmQuarterBeforeBeamedEighth"
            ),
            "rhythmPlainQuarterPairBeforeBeams": sum(
                1 for x in rhythm_suspects if x["code"] == "rhythmPlainQuarterPairBeforeBeams"
            ),
            "tupletStartTags": tuplet_starts,
        },
        "byPageStaff": [
            {"key": k, "count": v} for k, v in sorted(by_page_staff.items())
        ],
        "pCauses": [
            "TEXTS(OCR)가 SYMBOLS 글리프를 선점 — Audiveris TextWord·OCR eng",
            "다성부 세로 정렬로 tuplet 숫자가 한 staff에만 붙음 — SYMBOLS/BEAMS",
            "♩↔♪ 오인(빔 8분→4분 등) — Audiveris RHYTHMS 단계(OMR raw에 이미 존재)",
            "마디 끝 𝄽8·타 성부 duration 맞추기 — 예전 legacy 후처리(현재 off면 발생 안 함)",
            "마디 경계 음 순서 — LINKS/RHYTHMS(heuristic)",
        ],
    }


def lint_mxl_file(
    mxl_path: Path,
    *,
    measure_offset_printed: int = 1,
    page_count: int = 1,
    labels_by_index: list[str] | None = None,
) -> dict[str, Any]:
    xml = load_score_xml_from_mxl(mxl_path)
    report = lint_score_xml(
        xml,
        measure_offset_printed=measure_offset_printed,
        page_count=page_count,
        labels_by_index=labels_by_index,
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
    ap.add_argument("--part-labels-json", type=Path, default=None)
    ap.add_argument(
        "--list-parts",
        action="store_true",
        help="MXL part-list만 JSON으로 stdout 출력 후 종료",
    )
    args = ap.parse_args()
    if not args.mxl.is_file():
        print(f"파일 없음: {args.mxl}", file=sys.stderr)
        return 2
    if args.list_parts:
        xml = load_score_xml_from_mxl(args.mxl)
        print(json.dumps({"parts": list_score_parts_from_xml(xml)}, ensure_ascii=False))
        return 0
    labels = load_part_labels_json(args.part_labels_json)
    report = lint_mxl_file(
        args.mxl,
        measure_offset_printed=args.measure_offset,
        page_count=max(1, args.page_count),
        labels_by_index=labels,
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
