#!/usr/bin/env python3
"""OMR HITL — 사람이 지정한 MusicXML 보정을 MXL에 적용."""
from __future__ import annotations

import io
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

_STEPS = ("C", "D", "E", "F", "G", "A", "B")
_SPURIOUS_WORDS = frozenset({"P", "p", "2P", "2p", "PR", "PL", "R", "L", "9"})


def _ns(root: ET.Element) -> str:
    t = root.tag
    return t[1 : t.index("}")] if t.startswith("{") else ""


def _q(ns: str, local: str) -> str:
    return f"{{{ns}}}{local}" if ns else local


def _local(el: ET.Element) -> str:
    t = el.tag
    return t[t.index("}") + 1 :] if t.startswith("{") else t


def _compact_text(text: str) -> str:
    return re.sub(r"\s+", "", (text or "").strip())


def load_mxl_root(mxl_path: Path) -> tuple[dict[str, bytes], str, ET.Element]:
    with zipfile.ZipFile(mxl_path, "r") as z:
        files = {name: z.read(name) for name in z.namelist()}
    container = files.get("META-INF/container.xml")
    if not container:
        raise ValueError("META-INF/container.xml 없음")
    m = re.search(rb'full-path="([^"]+)"', container)
    if not m:
        raise ValueError("container.xml에 rootfile 없음")
    root_path = m.group(1).decode("utf-8")
    root = ET.parse(io.BytesIO(files[root_path])).getroot()
    return files, root_path, root


def write_mxl_root(mxl_path: Path, files: dict[str, bytes], root_path: str, root: ET.Element) -> None:
    files[root_path] = ET.tostring(root, encoding="UTF-8", xml_declaration=True)
    with zipfile.ZipFile(mxl_path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            z.writestr(name, data)


def find_part(root: ET.Element, ns: str, part_id: str) -> ET.Element | None:
    for part in root.findall(_q(ns, "part")):
        if part.get("id") == part_id:
            return part
    return None


def find_measure(part: ET.Element, ns: str, measure_mxl: str) -> ET.Element | None:
    target = str(measure_mxl).strip()
    for measure in part.findall(_q(ns, "measure")):
        if measure.get("number") == target:
            return measure
    return None


def list_note_elements(measure: ET.Element, ns: str) -> list[ET.Element]:
    return [el for el in measure if _local(el) == "note"]


def note_snapshot(note: ET.Element, ns: str, index: int) -> dict[str, Any]:
    rest_el = note.find(_q(ns, "rest"))
    pitch_el = note.find(_q(ns, "pitch"))
    staff_el = note.find(_q(ns, "staff"))
    voice_el = note.find(_q(ns, "voice"))
    type_el = note.find(_q(ns, "type"))
    chord = note.find(_q(ns, "chord")) is not None
    display_step = None
    display_octave = None
    if rest_el is not None:
        ds = rest_el.find(_q(ns, "display-step"))
        do = rest_el.find(_q(ns, "display-octave"))
        if ds is not None and ds.text:
            display_step = ds.text.strip()
        if do is not None and do.text:
            display_octave = do.text.strip()
    pitch = None
    if pitch_el is not None:
        step = pitch_el.find(_q(ns, "step"))
        oct_el = pitch_el.find(_q(ns, "octave"))
        if step is not None and oct_el is not None and step.text and oct_el.text:
            pitch = f"{step.text.strip()}{oct_el.text.strip()}"
    return {
        "index": index,
        "kind": "rest" if rest_el is not None else "note",
        "type": (type_el.text or "").strip() if type_el is not None and type_el.text else None,
        "staff": int(staff_el.text) if staff_el is not None and staff_el.text and staff_el.text.isdigit() else None,
        "voice": (voice_el.text or "").strip() if voice_el is not None and voice_el.text else None,
        "chord": chord,
        "pitch": pitch,
        "displayStep": display_step,
        "displayOctave": display_octave,
        "measureRest": rest_el is not None and rest_el.get("measure") == "yes",
    }


def measure_snapshot(root: ET.Element, ns: str, part_id: str, measure_mxl: str) -> dict[str, Any] | None:
    part = find_part(root, ns, part_id)
    if part is None:
        return None
    measure = find_measure(part, ns, measure_mxl)
    if measure is None:
        return None
    notes = list_note_elements(measure, ns)
    return {
        "partId": part_id,
        "measureMxl": str(measure_mxl),
        "notes": [note_snapshot(n, ns, i) for i, n in enumerate(notes)],
    }


def _diatonic_index(step: str, octave: int) -> int:
    s = step.strip().upper()
    if s not in _STEPS:
        s = "C"
    return octave * 7 + _STEPS.index(s)


def _from_diatonic_index(idx: int) -> tuple[str, int]:
    octave = idx // 7
    step = _STEPS[idx % 7]
    return step, octave


def nudge_display_step(step: str, octave: int, line_delta: int) -> tuple[str, int]:
    """오선에서 한 줄(line_delta=1은 아래쪽 줄) 이동."""
    base = _diatonic_index(step, octave)
    return _from_diatonic_index(base + line_delta * 2)


def _direction_text(direction: ET.Element) -> str:
    parts: list[str] = []
    for el in direction.iter():
        if _local(el) in ("words", "text", "syllable", "rehearsal"):
            if el.text and el.text.strip():
                parts.append(el.text.strip())
    return " ".join(parts).strip()


def _is_spurious_detail(text: str, detail: str | None) -> bool:
    compact = _compact_text(text)
    want = _compact_text(detail or "")
    if want and compact == want:
        return True
    if compact in _SPURIOUS_WORDS:
        return True
    if len(compact) <= 3 and compact.isdigit():
        return True
    if re.fullmatch(r"[Pp]{1,3}", compact or ""):
        return True
    return False


def apply_fix(root: ET.Element, ns: str, fix: dict[str, Any]) -> bool:
    kind = fix.get("kind")
    part_id = str(fix.get("partId") or "").strip()
    measure_mxl = str(fix.get("measureMxl") or "").strip()
    if not part_id or not measure_mxl:
        return False
    part = find_part(root, ns, part_id)
    if part is None:
        return False
    measure = find_measure(part, ns, measure_mxl)
    if measure is None:
        return False

    if kind == "removeSpuriousDirection":
        detail = fix.get("detail")
        removed = False
        for direction in list(measure.findall(_q(ns, "direction"))):
            if _is_spurious_detail(_direction_text(direction), str(detail) if detail else None):
                measure.remove(direction)
                removed = True
        return removed

    notes = list_note_elements(measure, ns)

    if kind == "removeTrailingPhantomRest":
        rest_type = str(fix.get("restType") or fix.get("detail") or "").strip()
        note_index = fix.get("noteIndex")
        if note_index is not None:
            try:
                idx = int(note_index)
            except (TypeError, ValueError):
                return False
            if 0 <= idx < len(notes):
                note = notes[idx]
                if note.find(_q(ns, "rest")) is not None:
                    measure.remove(note)
                    return True
            return False
        for note in reversed(notes):
            if note.find(_q(ns, "rest")) is None:
                continue
            typ = note.find(_q(ns, "type"))
            tval = (typ.text or "").strip() if typ is not None and typ.text else ""
            if not rest_type or tval == rest_type:
                measure.remove(note)
                return True
        return False

    if kind == "setNoteStaff":
        try:
            idx = int(fix.get("noteIndex"))
            staff_n = int(fix.get("staff"))
        except (TypeError, ValueError):
            return False
        if idx < 0 or idx >= len(notes):
            return False
        note = notes[idx]
        staff_el = note.find(_q(ns, "staff"))
        if staff_el is None:
            staff_el = ET.SubElement(note, _q(ns, "staff"))
        staff_el.text = str(staff_n)
        return True

    if kind == "nudgeRestDisplay":
        try:
            idx = int(fix.get("noteIndex"))
            line_delta = int(fix.get("lineDelta", 0))
        except (TypeError, ValueError):
            return False
        if idx < 0 or idx >= len(notes):
            return False
        note = notes[idx]
        rest_el = note.find(_q(ns, "rest"))
        if rest_el is None:
            return False
        step_el = rest_el.find(_q(ns, "display-step"))
        oct_el = rest_el.find(_q(ns, "display-octave"))
        step = (step_el.text or "B").strip() if step_el is not None and step_el.text else "B"
        try:
            octave = int(oct_el.text) if oct_el is not None and oct_el.text else 4
        except ValueError:
            octave = 4
        if fix.get("displayStep") and fix.get("displayOctave") is not None:
            n_step = str(fix["displayStep"]).strip()
            try:
                n_oct = int(fix["displayOctave"])
            except (TypeError, ValueError):
                return False
        else:
            n_step, n_oct = nudge_display_step(step, octave, line_delta)
        if step_el is None:
            step_el = ET.SubElement(rest_el, _q(ns, "display-step"))
        if oct_el is None:
            oct_el = ET.SubElement(rest_el, _q(ns, "display-octave"))
        step_el.text = n_step
        oct_el.text = str(n_oct)
        return True

    if kind == "removeNote":
        try:
            idx = int(fix.get("noteIndex"))
        except (TypeError, ValueError):
            return False
        if 0 <= idx < len(notes):
            measure.remove(notes[idx])
            return True
        return False

    return False


def apply_fixes_to_root(root: ET.Element, fixes: list[dict[str, Any]]) -> dict[str, int]:
    ns = _ns(root)
    stats = {"applied": 0, "skipped": 0}
    for fix in fixes:
        if apply_fix(root, ns, fix):
            stats["applied"] += 1
        else:
            stats["skipped"] += 1
    return stats


def apply_fixes_file(mxl_path: Path, fixes: list[dict[str, Any]]) -> dict[str, Any]:
    files, root_path, root = load_mxl_root(mxl_path)
    stats = apply_fixes_to_root(root, fixes)
    write_mxl_root(mxl_path, files, root_path, root)
    return {"path": str(mxl_path), **stats, "fixCount": len(fixes)}


def load_fixes_json(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if isinstance(data, dict) and isinstance(data.get("fixes"), list):
        return list(data["fixes"])
    if isinstance(data, list):
        return data
    return []


def save_fixes_json(path: Path, fixes: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"version": 1, "fixes": fixes, "savedAt": __import__("datetime").datetime.now().isoformat()}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def lint_issue_to_fix(issue: dict[str, Any]) -> dict[str, Any] | None:
    code = issue.get("code")
    part_id = issue.get("partId")
    measure_mxl = issue.get("measureMxl")
    if not part_id or not measure_mxl:
        return None
    if code == "spuriousDirection":
        return {
            "kind": "removeSpuriousDirection",
            "partId": part_id,
            "measureMxl": str(measure_mxl),
            "detail": issue.get("detail"),
            "source": "lint",
            "lintCode": code,
        }
    if code == "trailingPhantomRest":
        fix: dict[str, Any] = {
            "kind": "removeTrailingPhantomRest",
            "partId": part_id,
            "measureMxl": str(measure_mxl),
            "restType": issue.get("detail"),
            "detail": issue.get("detail"),
            "source": "lint",
            "lintCode": code,
        }
        if issue.get("noteIndex") is not None:
            fix["noteIndex"] = issue["noteIndex"]
        return fix
    if code == "restMissingStaff":
        return {
            "kind": "setNoteStaff",
            "partId": part_id,
            "measureMxl": str(measure_mxl),
            "noteIndex": issue.get("noteIndex"),
            "staff": issue.get("suggestedStaff", 2),
            "source": "lint",
            "lintCode": code,
        }
    if code == "restDisplayHigh":
        return {
            "kind": "nudgeRestDisplay",
            "partId": part_id,
            "measureMxl": str(measure_mxl),
            "noteIndex": issue.get("noteIndex"),
            "lineDelta": issue.get("suggestedLineDelta", 1),
            "source": "lint",
            "lintCode": code,
        }
    return None
