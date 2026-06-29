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


def _effective_divisions_and_time(
    part: ET.Element, ns: str, target_measure: ET.Element
) -> tuple[int, int, int]:
    """divisions·박자표는 보통 1번 마디에만 선언되므로 파트 처음부터 누적 추적한다."""
    divisions = 1
    beats = 4
    beat_type = 4
    for measure in part.findall(_q(ns, "measure")):
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
        if measure is target_measure:
            break
    return divisions, beats, beat_type


def _measure_length_units(divisions: int, beats: int, beat_type: int) -> int:
    return max(1, round(divisions * beats * 4 / beat_type))


def _duration_for_type_dots(note_type: str, divisions: int, dot_count: int) -> int:
    beats = {
        "whole": 4.0,
        "half": 2.0,
        "quarter": 1.0,
        "eighth": 0.5,
        "16th": 0.25,
        "32nd": 0.125,
    }.get(note_type)
    if beats is None:
        return 0
    mult = 1.0
    if dot_count == 1:
        mult = 1.5
    elif dot_count >= 2:
        mult = 1.75
    return max(1, int(round(beats * divisions * mult)))


def _undot_duration_guess(current: int, divisions: int, measure_len: int) -> int | None:
    """<type> 없는 쉼표: duration이 표준 길이의 1.5배(점)·1.75배(겹점)이면 기본 길이로 줄인다.

    Audiveris가 점을 <dot> 없이 duration에만 반영해 내보내는 경우,
    OSMD는 duration에서 점을 추론해 그리므로 duration을 고쳐야 점이 사라진다.
    """
    if current <= 0:
        return None
    bases = [measure_len, 4 * divisions, 2 * divisions, divisions]
    for sub in (2, 4, 8):
        if divisions % sub == 0 and divisions // sub > 0:
            bases.append(divisions // sub)
    for base in bases:
        if base > 0 and current == base:
            return None  # 이미 점 없는 표준 길이
    for base in bases:
        if base <= 0:
            continue
        if current * 2 == base * 3 or current * 4 == base * 7:
            return base
    if current > measure_len:
        return measure_len
    return None


def _undotted_duration_for_type(note_type: str, divisions: int) -> int | None:
    base = {
        "whole": 4,
        "half": 2,
        "quarter": 1,
        "eighth": 1,
        "16th": 1,
        "32nd": 1,
    }.get(note_type)
    if base is None:
        return None
    if note_type in ("eighth", "16th", "32nd"):
        factor = {"eighth": 2, "16th": 4, "32nd": 8}[note_type]
        return max(1, divisions // factor)
    return base * divisions


def find_measure(part: ET.Element, ns: str, measure_mxl: str) -> ET.Element | None:
    target = str(measure_mxl).strip()
    for measure in part.findall(_q(ns, "measure")):
        if measure.get("number") == target:
            return measure
    return None


def list_note_elements(measure: ET.Element, ns: str) -> list[ET.Element]:
    return [el for el in measure if _local(el) == "note"]


def _note_tie_flags(note: ET.Element, ns: str) -> tuple[bool, bool]:
    tie_start = False
    tie_stop = False
    notations = note.find(_q(ns, "notations"))
    if notations is None:
        return tie_start, tie_stop
    for tied in notations.findall(_q(ns, "tied")):
        t = (tied.get("type") or "").strip()
        if t == "start":
            tie_start = True
        elif t == "stop":
            tie_stop = True
    return tie_start, tie_stop


def _note_beams(note: ET.Element, ns: str) -> list[str]:
    """MusicXML `<beam>`는 `<note>` 직계 자식. 예전 HITL은 `<notations>` 아래에 쓴 경우도 읽는다."""
    out: list[str] = []
    for beam in note.findall(_q(ns, "beam")):
        if beam.text and beam.text.strip():
            out.append(beam.text.strip())
    if out:
        return out
    notations = note.find(_q(ns, "notations"))
    if notations is None:
        return []
    for beam in notations.findall(_q(ns, "beam")):
        if beam.text and beam.text.strip():
            out.append(beam.text.strip())
    return out


def note_snapshot(note: ET.Element, ns: str, index: int) -> dict[str, Any]:
    rest_el = note.find(_q(ns, "rest"))
    pitch_el = note.find(_q(ns, "pitch"))
    staff_el = note.find(_q(ns, "staff"))
    voice_el = note.find(_q(ns, "voice"))
    type_el = note.find(_q(ns, "type"))
    stem_el = note.find(_q(ns, "stem"))
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
    pitch_alter = None
    if pitch_el is not None:
        step = pitch_el.find(_q(ns, "step"))
        oct_el = pitch_el.find(_q(ns, "octave"))
        alter_el = pitch_el.find(_q(ns, "alter"))
        if step is not None and oct_el is not None and step.text and oct_el.text:
            pitch = f"{step.text.strip()}{oct_el.text.strip()}"
        if alter_el is not None and alter_el.text:
            try:
                pitch_alter = int(float(alter_el.text.strip()))
            except ValueError:
                pitch_alter = None
    tie_start, tie_stop = _note_tie_flags(note, ns)
    duration = None
    dur_el = note.find(_q(ns, "duration"))
    if dur_el is not None and dur_el.text and dur_el.text.strip().isdigit():
        duration = int(dur_el.text.strip())
    dot_count = len(note.findall(_q(ns, "dot")))
    note_type = (type_el.text or "").strip() if type_el is not None and type_el.text else None
    grace_el = note.find(_q(ns, "grace"))
    time_mod = None
    tm_el = note.find(_q(ns, "time-modification"))
    if tm_el is not None:
        an = tm_el.find(_q(ns, "actual-notes"))
        nn = tm_el.find(_q(ns, "normal-notes"))
        if an is not None and an.text and nn is not None and nn.text:
            time_mod = f"{an.text.strip()}:{nn.text.strip()}"
    tuplet = None
    articulations: list[str] = []
    for notations in note.findall(_q(ns, "notations")):
        for tup in notations.findall(_q(ns, "tuplet")):
            tuplet = tup.get("type") or tuplet
        for arts in notations.findall(_q(ns, "articulations")):
            for art in arts:
                name = _local(art)
                placement = art.get("placement")
                articulations.append(f"{name}({placement})" if placement else name)
    return {
        "index": index,
        "elementKind": "note",
        "kind": "rest" if rest_el is not None else "note",
        "type": note_type,
        "duration": duration,
        "isDotted": dot_count > 0,
        "hasGrace": grace_el is not None,
        "isCue": note.get("cue") == "yes",
        "staff": int(staff_el.text) if staff_el is not None and staff_el.text and staff_el.text.isdigit() else None,
        "voice": (voice_el.text or "").strip() if voice_el is not None and voice_el.text else None,
        "chord": chord,
        "pitch": pitch,
        "pitchAlter": pitch_alter,
        "displayStep": display_step,
        "displayOctave": display_octave,
        "measureRest": rest_el is not None and rest_el.get("measure") == "yes",
        "dotCount": dot_count,
        "tieStart": tie_start,
        "tieStop": tie_stop,
        "beams": _note_beams(note, ns),
        "stem": (stem_el.text or "").strip() if stem_el is not None and stem_el.text else None,
        "timeMod": time_mod,
        "tuplet": tuplet,
        "articulations": articulations,
    }


def measure_elements_snapshot(measure: ET.Element, ns: str) -> list[dict[str, Any]]:
    elements: list[dict[str, Any]] = []
    direction_index = 0
    note_index = 0
    for child in measure:
        local = _local(child)
        if local == "direction":
            elements.append(
                {
                    "elementKind": "direction",
                    "directionIndex": direction_index,
                    "text": _direction_text(child),
                }
            )
            direction_index += 1
        elif local == "note":
            elements.append(note_snapshot(child, ns, note_index))
            note_index += 1
    return elements


def measure_snapshot(root: ET.Element, ns: str, part_id: str, measure_mxl: str) -> dict[str, Any] | None:
    part = find_part(root, ns, part_id)
    if part is None:
        return None
    measure = find_measure(part, ns, measure_mxl)
    if measure is None:
        return None
    notes = list_note_elements(measure, ns)
    elements = measure_elements_snapshot(measure, ns)
    return {
        "partId": part_id,
        "measureMxl": str(measure_mxl),
        "notes": [note_snapshot(n, ns, i) for i, n in enumerate(notes)],
        "elements": elements,
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


def _note_staff_number(note: ET.Element, ns: str) -> int | None:
    staff_el = note.find(_q(ns, "staff"))
    if staff_el is None or not staff_el.text or not staff_el.text.strip().isdigit():
        return None
    return int(staff_el.text.strip())


def _infer_voice_stem_from_neighbors(
    notes: list[ET.Element], ns: str, after_idx: int, staff_n: int
) -> tuple[str, str | None]:
    """삽입 위치 앞·뒤·같은 스태프 이웃에서 voice·stem을 복사."""
    candidates: list[ET.Element] = []
    if 0 <= after_idx < len(notes):
        candidates.append(notes[after_idx])
    if after_idx + 1 < len(notes):
        candidates.append(notes[after_idx + 1])
    if after_idx - 1 >= 0:
        candidates.append(notes[after_idx - 1])
    voice = "1"
    stem: str | None = None
    for note in candidates:
        st = _note_staff_number(note, ns)
        if st is not None and st != staff_n:
            continue
        voice_el = note.find(_q(ns, "voice"))
        if voice_el is not None and voice_el.text and voice_el.text.strip():
            voice = voice_el.text.strip()
        stem_el = note.find(_q(ns, "stem"))
        if stem_el is not None and stem_el.text:
            stem_val = stem_el.text.strip().lower()
            if stem_val in ("up", "down"):
                stem = stem_val
        if voice != "1" and stem is not None:
            break
    return voice, stem


def _infer_stem_from_pitch(step: str, octave: int) -> str:
    """오선 중간(B4) 기준으로 stem 방향 추정 — OSMD·악보 관례."""
    try:
        idx = _diatonic_index(step, octave)
    except ValueError:
        return "up"
    return "down" if idx >= _diatonic_index("B", 4) else "up"


def _build_inserted_pitched_note(
    ns: str,
    *,
    step: str,
    octave: int,
    alter: int | None,
    note_type: str,
    divisions: int,
    staff_n: int,
    voice: str,
    stem: str | None,
    dot_count: int = 0,
) -> ET.Element:
    """MusicXML 순서(pitch→duration→voice→type→stem→staff)로 일반 크기 음표 생성."""
    new_note = ET.Element(_q(ns, "note"))
    pitch_el = ET.SubElement(new_note, _q(ns, "pitch"))
    ET.SubElement(pitch_el, _q(ns, "step")).text = step
    ET.SubElement(pitch_el, _q(ns, "octave")).text = str(octave)
    if alter is not None:
        ET.SubElement(pitch_el, _q(ns, "alter")).text = str(int(alter))
    target_dur = _duration_for_type_dots(note_type, divisions, dot_count)
    if target_dur > 0:
        ET.SubElement(new_note, _q(ns, "duration")).text = str(target_dur)
    ET.SubElement(new_note, _q(ns, "voice")).text = voice
    ET.SubElement(new_note, _q(ns, "type")).text = note_type
    for _ in range(dot_count):
        ET.SubElement(new_note, _q(ns, "dot"))
    stem_val = stem if stem in ("up", "down") else _infer_stem_from_pitch(step, octave)
    ET.SubElement(new_note, _q(ns, "stem")).text = stem_val
    ET.SubElement(new_note, _q(ns, "staff")).text = str(staff_n)
    return new_note


def _build_inserted_rest_note(
    ns: str,
    *,
    rest_type: str,
    divisions: int,
    staff_n: int,
    voice: str,
    display_step: str = "B",
    display_octave: int = 4,
) -> ET.Element:
    new_note = ET.Element(_q(ns, "note"))
    rest_el = ET.SubElement(new_note, _q(ns, "rest"))
    target_dur = _duration_for_type_dots(rest_type, divisions, 0)
    if target_dur > 0:
        ET.SubElement(new_note, _q(ns, "duration")).text = str(target_dur)
    ET.SubElement(new_note, _q(ns, "voice")).text = voice
    ET.SubElement(new_note, _q(ns, "type")).text = rest_type
    if rest_type in ("whole", "half"):
        ET.SubElement(rest_el, _q(ns, "display-step")).text = display_step
        ET.SubElement(rest_el, _q(ns, "display-octave")).text = str(display_octave)
    ET.SubElement(new_note, _q(ns, "staff")).text = str(staff_n)
    return new_note


def _normalize_measure_note_engraving(
    part: ET.Element, ns: str, measure: ET.Element
) -> bool:
    """HITL로 넣은 음·쉼표에 빠진 duration·voice·stem을 보강(일반 크기 렌더링)."""
    divisions, _, _ = _effective_divisions_and_time(part, ns, measure)
    notes = list_note_elements(measure, ns)
    if not notes:
        return False
    default_voice = "1"
    for note in notes:
        voice_el = note.find(_q(ns, "voice"))
        if voice_el is not None and voice_el.text and voice_el.text.strip():
            default_voice = voice_el.text.strip()
            break
    changed = False
    for note in notes:
        if note.find(_q(ns, "grace")) is not None or note.get("cue") == "yes":
            continue
        type_el = note.find(_q(ns, "type"))
        note_type = (type_el.text or "").strip() if type_el is not None and type_el.text else ""
        if not note_type:
            continue
        dot_count = len(note.findall(_q(ns, "dot")))
        target_dur = _duration_for_type_dots(note_type, divisions, dot_count)
        dur_el = note.find(_q(ns, "duration"))
        if target_dur > 0 and (
            dur_el is None or not (dur_el.text or "").strip().isdigit()
        ):
            if dur_el is None:
                dur_el = ET.Element(_q(ns, "duration"))
                pitch_or_rest = note.find(_q(ns, "pitch")) or note.find(_q(ns, "rest"))
                if pitch_or_rest is not None:
                    note.insert(list(note).index(pitch_or_rest) + 1, dur_el)
                else:
                    note.insert(0, dur_el)
            dur_el.text = str(target_dur)
            changed = True
        voice_el = note.find(_q(ns, "voice"))
        if voice_el is None:
            voice_el = ET.SubElement(note, _q(ns, "voice"))
            voice_el.text = default_voice
            changed = True
        elif not (voice_el.text or "").strip():
            voice_el.text = default_voice
            changed = True
        if note.find(_q(ns, "pitch")) is not None and note.find(_q(ns, "stem")) is None:
            pitch_el = note.find(_q(ns, "pitch"))
            step_el = pitch_el.find(_q(ns, "step")) if pitch_el is not None else None
            oct_el = pitch_el.find(_q(ns, "octave")) if pitch_el is not None else None
            step = (step_el.text or "C").strip() if step_el is not None and step_el.text else "C"
            try:
                octave = int(oct_el.text.strip()) if oct_el is not None and oct_el.text else 4
            except ValueError:
                octave = 4
            stem_el = ET.SubElement(note, _q(ns, "stem"))
            stem_el.text = _infer_stem_from_pitch(step, octave)
            changed = True
    return changed


def _insert_note_element(measure: ET.Element, ns: str, new_note: ET.Element, after_note_index: int) -> None:
    """after_note_index=-1 이면 첫 note 앞, 그 외에는 해당 note 바로 뒤."""
    children = list(measure)
    if after_note_index < 0:
        for child in children:
            if _local(child) == "note":
                measure.insert(children.index(child), new_note)
                return
        measure.append(new_note)
        return
    seen = -1
    for child in children:
        if _local(child) != "note":
            continue
        seen += 1
        if seen == after_note_index:
            pos = children.index(child) + 1
            measure.insert(pos, new_note)
            return
    measure.append(new_note)


def _ensure_notations(note: ET.Element, ns: str) -> ET.Element:
    notations = note.find(_q(ns, "notations"))
    if notations is None:
        notations = ET.SubElement(note, _q(ns, "notations"))
    return notations


def _note_pitch_str(note: ET.Element, ns: str) -> str | None:
    pitch_el = note.find(_q(ns, "pitch"))
    if pitch_el is None:
        return None
    step_el = pitch_el.find(_q(ns, "step"))
    oct_el = pitch_el.find(_q(ns, "octave"))
    alter_el = pitch_el.find(_q(ns, "alter"))
    if step_el is None or oct_el is None or not step_el.text or not oct_el.text:
        return None
    step = step_el.text.strip()
    octave = oct_el.text.strip()
    if alter_el is not None and alter_el.text:
        try:
            alter = int(float(alter_el.text.strip()))
            if alter > 0:
                return f"{step}#{octave}"
            if alter < 0:
                return f"{step}b{octave}"
        except ValueError:
            pass
    return f"{step}{octave}"


def _note_voice_staff(note: ET.Element, ns: str) -> tuple[str, str]:
    voice_el = note.find(_q(ns, "voice"))
    staff_el = note.find(_q(ns, "staff"))
    voice = (voice_el.text or "1").strip() if voice_el is not None and voice_el.text else "1"
    staff = (staff_el.text or "1").strip() if staff_el is not None and staff_el.text else "1"
    return voice, staff


def _resolve_beam_endpoint(
    notes: list[ET.Element],
    ns: str,
    idx: int,
    pitch_hint: Any,
) -> int:
    hint = str(pitch_hint or "").strip()
    if 0 <= idx < len(notes) and (not hint or _note_pitch_str(notes[idx], ns) == hint):
        return idx
    if not hint:
        return idx
    matches = [
        i
        for i, n in enumerate(notes)
        if _is_beamable_pitched_note(n, ns) and _note_pitch_str(n, ns) == hint
    ]
    if not matches:
        return idx
    if len(matches) == 1:
        return matches[0]
    return min(matches, key=lambda i: abs(i - idx))


def _is_beamable_pitched_note(note: ET.Element, ns: str) -> bool:
    if note.find(_q(ns, "rest")) is not None or note.find(_q(ns, "pitch")) is None:
        return False
    if note.find(_q(ns, "chord")) is not None:
        return False
    return True


def _strip_beams_from_note(
    note: ET.Element, ns: str, beam_number: int | None = None
) -> bool:
    changed = False

    def _should_remove(beam: ET.Element) -> bool:
        if beam_number is None:
            return True
        try:
            return int(beam.get("number") or "1") == beam_number
        except ValueError:
            return beam_number == 1

    for beam in list(note.findall(_q(ns, "beam"))):
        if _should_remove(beam):
            note.remove(beam)
            changed = True
    notations = note.find(_q(ns, "notations"))
    if notations is not None:
        for beam in list(notations.findall(_q(ns, "beam"))):
            if _should_remove(beam):
                notations.remove(beam)
                changed = True
        if len(notations) == 0:
            note.remove(notations)
    return changed


def _set_beam_on_note(note: ET.Element, ns: str, beam_number: int, value: str) -> None:
    if note.find(_q(ns, "rest")) is not None:
        return
    for beam in list(note.findall(_q(ns, "beam"))):
        try:
            n = int(beam.get("number") or "1")
        except ValueError:
            n = 1
        if n == beam_number:
            note.remove(beam)
    notations = note.find(_q(ns, "notations"))
    if notations is not None:
        for beam in list(notations.findall(_q(ns, "beam"))):
            try:
                n = int(beam.get("number") or "1")
            except ValueError:
                n = 1
            if n == beam_number:
                notations.remove(beam)
    beam_el = ET.Element(_q(ns, "beam"))
    if beam_number != 1:
        beam_el.set("number", str(beam_number))
    beam_el.text = value
    anchor = (
        note.find(_q(ns, "stem"))
        or note.find(_q(ns, "staff"))
        or note.find(_q(ns, "type"))
    )
    if anchor is not None:
        note.insert(list(note).index(anchor) + 1, beam_el)
    else:
        note.append(beam_el)


def _chord_follower_indices(notes: list[ET.Element], ns: str, leader_idx: int) -> list[int]:
    out: list[int] = []
    for j in range(leader_idx + 1, len(notes)):
        if notes[j].find(_q(ns, "chord")) is not None:
            out.append(j)
        else:
            break
    return out


def _apply_beam_to_range(
    notes: list[ET.Element],
    ns: str,
    indices: list[int],
    beam_number: int = 1,
) -> bool:
    pitched = [
        i
        for i in indices
        if 0 <= i < len(notes) and _is_beamable_pitched_note(notes[i], ns)
    ]
    if len(pitched) < 2:
        return False
    group_keys = {_note_voice_staff(notes[i], ns) for i in pitched}
    if len(group_keys) != 1:
        return False
    voice, staff = next(iter(group_keys))
    for note in notes:
        v, s = _note_voice_staff(note, ns)
        if v == voice and s == staff:
            _strip_beams_from_note(note, ns, beam_number)
    for pos, idx in enumerate(pitched):
        if pos == 0:
            val = "begin"
        elif pos == len(pitched) - 1:
            val = "end"
        else:
            val = "continue"
        targets = [idx, *_chord_follower_indices(notes, ns, idx)]
        for tidx in targets:
            _set_beam_on_note(notes[tidx], ns, beam_number, val)
    return True


def _strip_tuplet_from_note(note: ET.Element, ns: str) -> bool:
    changed = False
    tm = note.find(_q(ns, "time-modification"))
    if tm is not None:
        note.remove(tm)
        changed = True
    for notations in list(note.findall(_q(ns, "notations"))):
        for tup in list(notations.findall(_q(ns, "tuplet"))):
            notations.remove(tup)
            changed = True
        if len(notations) == 0:
            note.remove(notations)
    return changed


def _set_time_modification(
    note: ET.Element,
    ns: str,
    actual_notes: int,
    normal_notes: int,
    normal_type: str,
) -> None:
    tm = note.find(_q(ns, "time-modification"))
    if tm is None:
        tm = ET.SubElement(note, _q(ns, "time-modification"))
    for tag in ("actual-notes", "normal-notes", "normal-type"):
        el = tm.find(_q(ns, tag))
        if el is not None:
            tm.remove(el)
    ET.SubElement(tm, _q(ns, "actual-notes")).text = str(actual_notes)
    ET.SubElement(tm, _q(ns, "normal-notes")).text = str(normal_notes)
    ET.SubElement(tm, _q(ns, "normal-type")).text = normal_type


def _tuplet_group_has_rest(notes: list[ET.Element], indices: list[int], ns: str) -> bool:
    for i in indices:
        if notes[i].find(_q(ns, "rest")) is not None:
            return True
    return False


def _infer_tuplet_placement(note: ET.Element, ns: str) -> str:
    stem_el = note.find(_q(ns, "stem"))
    stem = (stem_el.text or "").strip().lower() if stem_el is not None and stem_el.text else ""
    if stem == "up":
        return "below"
    if stem == "down":
        return "above"
    return "above"


def _apply_triplet_to_range(
    notes: list[ET.Element],
    ns: str,
    indices: list[int],
    divisions: int,
    actual_notes: int,
    normal_notes: int,
    normal_type: str,
) -> bool:
    if len(indices) < 2 or actual_notes < 2 or normal_notes < 1:
        return False
    normal_dur = _duration_for_type_dots(normal_type, divisions, 0)
    if normal_dur <= 0:
        return False
    total = normal_dur * normal_notes
    per_note = max(1, total // actual_notes)
    has_rest = _tuplet_group_has_rest(notes, indices, ns)
    placement = _infer_tuplet_placement(notes[indices[0]], ns)
    changed = False
    for pos, idx in enumerate(indices):
        note = notes[idx]
        if note.find(_q(ns, "rest")) is not None and note.find(_q(ns, "pitch")) is None:
            pass
        type_el = note.find(_q(ns, "type"))
        if type_el is None:
            type_el = ET.SubElement(note, _q(ns, "type"))
        if (type_el.text or "").strip() != normal_type:
            type_el.text = normal_type
            changed = True
        _set_time_modification(note, ns, actual_notes, normal_notes, normal_type)
        dur_el = note.find(_q(ns, "duration"))
        if dur_el is None:
            dur_el = ET.SubElement(note, _q(ns, "duration"))
        if (dur_el.text or "").strip() != str(per_note):
            dur_el.text = str(per_note)
            changed = True
        for old_tm in list(note.findall(_q(ns, "notations"))):
            for tup in list(old_tm.findall(_q(ns, "tuplet"))):
                old_tm.remove(tup)
        notations = _ensure_notations(note, ns)
        if pos == 0:
            tuplet = ET.SubElement(notations, _q(ns, "tuplet"), {"type": "start"})
            tuplet.set("number", "1")
            tuplet.set("show-number", "actual")
            if has_rest:
                tuplet.set("show-bracket", "yes")
                tuplet.set("bracket", "yes")
                tuplet.set("placement", placement)
            else:
                tuplet.set("show-bracket", "no")
                tuplet.set("placement", placement)
            changed = True
        elif pos == len(indices) - 1:
            ET.SubElement(notations, _q(ns, "tuplet"), {"type": "stop"})
            changed = True
    return changed


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


def _looks_like_spurious_rest_dot_note(note: ET.Element, ns: str) -> bool:
    """쉼표 뒤에 붙은 잘못된 점·짧은 음표(OMR 오인식) 여부."""
    if note.find(_q(ns, "grace")) is not None:
        return True
    if note.get("cue") == "yes":
        return True
    if note.find(_q(ns, "chord")) is not None:
        return True
    type_el = note.find(_q(ns, "type"))
    note_type = (type_el.text or "").strip() if type_el is not None and type_el.text else ""
    if note_type in ("128th", "256th", "32nd", "64th"):
        return True
    if len(note.findall(_q(ns, "dot"))) > 0 and note.find(_q(ns, "rest")) is None:
        return True
    dur_el = note.find(_q(ns, "duration"))
    if dur_el is not None and dur_el.text and dur_el.text.strip().isdigit():
        try:
            if int(dur_el.text.strip()) <= 8:
                return True
        except ValueError:
            pass
    return False


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

    if kind == "removeArticulation":
        try:
            idx = int(fix.get("noteIndex"))
        except (TypeError, ValueError):
            return False
        if idx < 0 or idx >= len(notes):
            return False
        note = notes[idx]
        # articulation 이름이 주어지면 그것만, 없으면 articulations 전부 제거
        target = str(fix.get("articulation") or "").strip().split("(")[0] or None
        removed = False
        for notations in list(note.findall(_q(ns, "notations"))):
            for arts in list(notations.findall(_q(ns, "articulations"))):
                for art in list(arts):
                    if target is None or _local(art) == target:
                        arts.remove(art)
                        removed = True
                if len(arts) == 0:
                    notations.remove(arts)
            if len(notations) == 0:
                note.remove(notations)
        return removed

    if kind in ("removeNoteDot", "setNoteUndotted", "clearRestDots"):
        try:
            idx = int(fix.get("noteIndex"))
        except (TypeError, ValueError):
            return False
        if idx < 0 or idx >= len(notes):
            return False
        note = notes[idx]
        changed = False
        for dot in list(note.findall(_q(ns, "dot"))):
            note.remove(dot)
            changed = True
        if kind in ("setNoteUndotted", "clearRestDots") or fix.get("clearDottedDuration"):
            divisions, beats, beat_type = _effective_divisions_and_time(part, ns, measure)
            measure_len = _measure_length_units(divisions, beats, beat_type)
            type_el = note.find(_q(ns, "type"))
            dur_el = note.find(_q(ns, "duration"))
            note_type = (type_el.text or "").strip() if type_el is not None and type_el.text else ""
            is_rest = note.find(_q(ns, "rest")) is not None
            current = 0
            if dur_el is not None and dur_el.text:
                try:
                    current = int(dur_el.text.strip())
                except ValueError:
                    current = 0
            target = _undotted_duration_for_type(note_type, divisions) if note_type else None
            if is_rest and note_type in ("whole", ""):
                # 온쉼표(또는 type 없는 마디 쉼표)는 박자표 기준 마디 길이가 정답
                target = min(target, measure_len) if target is not None else None
                if target is None:
                    target = _undot_duration_guess(current, divisions, measure_len)
                    if target is None and current > measure_len:
                        target = measure_len
            elif target is None and is_rest:
                target = _undot_duration_guess(current, divisions, measure_len)
            if target is not None and dur_el is not None and 0 < target < current:
                dur_el.text = str(target)
                changed = True
        if kind == "clearRestDots" and fix.get("removeFollowingNote"):
            notes_after = list_note_elements(measure, ns)
            if idx + 1 < len(notes_after):
                nxt = notes_after[idx + 1]
                if _looks_like_spurious_rest_dot_note(nxt, ns):
                    measure.remove(nxt)
                    changed = True
        return changed

    if kind == "removeDirection":
        try:
            direction_index = int(fix.get("directionIndex"))
        except (TypeError, ValueError):
            return False
        directions = measure.findall(_q(ns, "direction"))
        if 0 <= direction_index < len(directions):
            measure.remove(directions[direction_index])
            return True
        return False

    if kind == "setNotePitch":
        try:
            idx = int(fix.get("noteIndex"))
        except (TypeError, ValueError):
            return False
        if idx < 0 or idx >= len(notes):
            return False
        note = notes[idx]
        pitch_el = note.find(_q(ns, "pitch"))
        if pitch_el is None:
            return False
        step = str(fix.get("pitchStep") or "").strip()
        if not step:
            return False
        try:
            octave = int(fix.get("pitchOctave"))
        except (TypeError, ValueError):
            return False
        step_el = pitch_el.find(_q(ns, "step"))
        oct_el = pitch_el.find(_q(ns, "octave"))
        if step_el is None:
            step_el = ET.SubElement(pitch_el, _q(ns, "step"))
        if oct_el is None:
            oct_el = ET.SubElement(pitch_el, _q(ns, "octave"))
        step_el.text = step
        oct_el.text = str(octave)
        alter = fix.get("pitchAlter")
        alter_el = pitch_el.find(_q(ns, "alter"))
        if alter is None or alter == "":
            if alter_el is not None:
                pitch_el.remove(alter_el)
        else:
            try:
                alter_n = int(alter)
            except (TypeError, ValueError):
                return False
            if alter_el is None:
                alter_el = ET.SubElement(pitch_el, _q(ns, "alter"))
            alter_el.text = str(alter_n)
        return True

    if kind == "setNoteType":
        try:
            idx = int(fix.get("noteIndex"))
        except (TypeError, ValueError):
            return False
        note_type = str(fix.get("noteType") or "").strip()
        if not note_type:
            return False
        if idx < 0 or idx >= len(notes):
            return False
        dot_count = 0
        if fix.get("dotCount") is not None:
            try:
                dot_count = max(0, min(2, int(fix.get("dotCount"))))
            except (TypeError, ValueError):
                dot_count = 0
        divisions, _beats, _bt = _effective_divisions_and_time(part, ns, measure)
        target_dur = _duration_for_type_dots(note_type, divisions, dot_count)
        targets = [idx]
        if notes[idx].find(_q(ns, "chord")) is None:
            targets.extend(_chord_follower_indices(notes, ns, idx))
        for tidx in targets:
            if tidx < 0 or tidx >= len(notes):
                continue
            note = notes[tidx]
            type_el = note.find(_q(ns, "type"))
            if type_el is None:
                type_el = ET.SubElement(note, _q(ns, "type"))
            type_el.text = note_type
            for dot in list(note.findall(_q(ns, "dot"))):
                note.remove(dot)
            for _ in range(dot_count):
                ET.SubElement(note, _q(ns, "dot"))
            if target_dur > 0:
                dur_el = note.find(_q(ns, "duration"))
                if dur_el is None:
                    dur_el = ET.SubElement(note, _q(ns, "duration"))
                dur_el.text = str(target_dur)
        return True

    if kind == "setNoteStem":
        try:
            idx = int(fix.get("noteIndex"))
        except (TypeError, ValueError):
            return False
        stem_val = str(fix.get("stem") or "").strip().lower()
        if stem_val not in ("up", "down"):
            return False
        if idx < 0 or idx >= len(notes):
            return False
        note = notes[idx]
        stem_el = note.find(_q(ns, "stem"))
        if stem_el is None:
            stem_el = ET.SubElement(note, _q(ns, "stem"))
        stem_el.text = stem_val
        return True

    if kind == "removeTie":
        try:
            idx = int(fix.get("noteIndex"))
        except (TypeError, ValueError):
            return False
        if idx < 0 or idx >= len(notes):
            return False
        which = str(fix.get("tieEnd") or "both").strip().lower()
        note = notes[idx]
        notations = note.find(_q(ns, "notations"))
        if notations is None:
            return False
        removed = False
        for tied in list(notations.findall(_q(ns, "tied"))):
            t = (tied.get("type") or "").strip()
            if which == "both" or which == t:
                notations.remove(tied)
                removed = True
        if not list(notations):
            note.remove(notations)
        return removed

    if kind == "addTie":
        try:
            from_idx = int(fix.get("fromNoteIndex"))
            to_idx = int(fix.get("toNoteIndex"))
        except (TypeError, ValueError):
            return False
        if from_idx < 0 or to_idx < 0 or from_idx >= len(notes) or to_idx >= len(notes):
            return False
        from_note = notes[from_idx]
        to_note = notes[to_idx]
        from_not = _ensure_notations(from_note, ns)
        to_not = _ensure_notations(to_note, ns)
        has_start = any((t.get("type") or "") == "start" for t in from_not.findall(_q(ns, "tied")))
        has_stop = any((t.get("type") or "") == "stop" for t in to_not.findall(_q(ns, "tied")))
        if not has_start:
            start = ET.SubElement(from_not, _q(ns, "tied"))
            start.set("type", "start")
        if not has_stop:
            stop = ET.SubElement(to_not, _q(ns, "tied"))
            stop.set("type", "stop")
        return True

    if kind == "insertRest":
        rest_type = str(fix.get("noteType") or fix.get("restType") or "quarter").strip()
        try:
            staff_n = int(fix.get("staff", 1))
            after_idx = int(fix.get("afterNoteIndex", -1))
        except (TypeError, ValueError):
            return False
        divisions, _beats, _bt = _effective_divisions_and_time(part, ns, measure)
        voice, _stem = _infer_voice_stem_from_neighbors(notes, ns, after_idx, staff_n)
        step = str(fix.get("displayStep") or "B").strip()
        try:
            octave = int(fix.get("displayOctave", 4))
        except (TypeError, ValueError):
            octave = 4
        new_note = _build_inserted_rest_note(
            ns,
            rest_type=rest_type,
            divisions=divisions,
            staff_n=staff_n,
            voice=voice,
            display_step=step,
            display_octave=octave,
        )
        _insert_note_element(measure, ns, new_note, after_idx)
        _normalize_measure_note_engraving(part, ns, measure)
        return True

    if kind == "insertNote":
        step = str(fix.get("pitchStep") or "").strip()
        if not step:
            return False
        try:
            octave = int(fix.get("pitchOctave"))
            staff_n = int(fix.get("staff", 1))
            after_idx = int(fix.get("afterNoteIndex", -1))
        except (TypeError, ValueError):
            return False
        note_type = str(fix.get("noteType") or "quarter").strip()
        divisions, _beats, _bt = _effective_divisions_and_time(part, ns, measure)
        voice, stem = _infer_voice_stem_from_neighbors(notes, ns, after_idx, staff_n)
        alter = fix.get("pitchAlter")
        alter_n: int | None = None
        if alter is not None and alter != "":
            try:
                alter_n = int(alter)
            except (TypeError, ValueError):
                alter_n = None
        new_note = _build_inserted_pitched_note(
            ns,
            step=step,
            octave=octave,
            alter=alter_n,
            note_type=note_type,
            divisions=divisions,
            staff_n=staff_n,
            voice=voice,
            stem=stem,
        )
        _insert_note_element(measure, ns, new_note, after_idx)
        _normalize_measure_note_engraving(part, ns, measure)
        return True

    if kind == "applyTriplet":
        try:
            from_idx = int(fix.get("fromNoteIndex"))
            to_idx = int(fix.get("toNoteIndex"))
            actual_notes = int(fix.get("actualNotes", 3))
            normal_notes = int(fix.get("normalNotes", 2))
        except (TypeError, ValueError):
            return False
        normal_type = str(fix.get("normalType") or "eighth").strip()
        if from_idx < 0 or to_idx < from_idx or to_idx >= len(notes):
            return False
        indices = list(range(from_idx, to_idx + 1))
        if len(indices) < 2:
            return False
        divisions, _beats, _bt = _effective_divisions_and_time(part, ns, measure)
        return _apply_triplet_to_range(
            notes, ns, indices, divisions, actual_notes, normal_notes, normal_type
        )

    if kind == "removeTriplet":
        try:
            from_idx = int(fix.get("fromNoteIndex"))
            to_idx = int(fix.get("toNoteIndex"))
        except (TypeError, ValueError):
            return False
        if from_idx < 0 or to_idx < from_idx or to_idx >= len(notes):
            return False
        changed = False
        for idx in range(from_idx, to_idx + 1):
            if _strip_tuplet_from_note(notes[idx], ns):
                changed = True
            note = notes[idx]
            type_el = note.find(_q(ns, "type"))
            note_type = (type_el.text or "").strip() if type_el is not None and type_el.text else "eighth"
            dot_count = len(note.findall(_q(ns, "dot")))
            divisions, _beats, _bt = _effective_divisions_and_time(part, ns, measure)
            target_dur = _duration_for_type_dots(note_type, divisions, dot_count)
            if target_dur > 0:
                dur_el = note.find(_q(ns, "duration"))
                if dur_el is None:
                    dur_el = ET.SubElement(note, _q(ns, "duration"))
                if (dur_el.text or "").strip() != str(target_dur):
                    dur_el.text = str(target_dur)
                    changed = True
        return changed

    if kind == "applyBeam":
        try:
            from_idx = int(fix.get("fromNoteIndex"))
            to_idx = int(fix.get("toNoteIndex"))
            beam_number = int(fix.get("beamNumber", 1))
        except (TypeError, ValueError):
            return False
        from_idx = _resolve_beam_endpoint(notes, ns, from_idx, fix.get("fromPitch"))
        to_idx = _resolve_beam_endpoint(notes, ns, to_idx, fix.get("toPitch"))
        if from_idx < 0 or to_idx < from_idx or to_idx >= len(notes):
            return False
        if beam_number < 1 or beam_number > 4:
            return False
        indices = list(range(from_idx, to_idx + 1))
        return _apply_beam_to_range(notes, ns, indices, beam_number)

    if kind == "removeBeam":
        try:
            from_idx = int(fix.get("fromNoteIndex"))
            to_idx = int(fix.get("toNoteIndex"))
        except (TypeError, ValueError):
            try:
                from_idx = to_idx = int(fix.get("noteIndex"))
            except (TypeError, ValueError):
                return False
        if from_idx < 0 or to_idx < from_idx or to_idx >= len(notes):
            return False
        beam_number_raw = fix.get("beamNumber")
        beam_number: int | None = None
        if beam_number_raw is not None and beam_number_raw != "":
            try:
                beam_number = int(beam_number_raw)
            except (TypeError, ValueError):
                return False
        changed = False
        for idx in range(from_idx, to_idx + 1):
            if _strip_beams_from_note(notes[idx], ns, beam_number):
                changed = True
            for fidx in _chord_follower_indices(notes, ns, idx):
                if _strip_beams_from_note(notes[fidx], ns, beam_number):
                    changed = True
        return changed

    return False


def _note_duration(note: ET.Element, ns: str) -> int:
    dur_el = note.find(_q(ns, "duration"))
    if dur_el is None or not dur_el.text:
        return 0
    try:
        return max(0, int(dur_el.text.strip()))
    except ValueError:
        return 0


def normalize_rest_durations_root(root: ET.Element) -> dict[str, int]:
    """Audiveris가 점·길이를 잘못 내보낸 쉼표 duration을 보수적으로 정규화.

    원리: 마디(보이스) 총 길이가 박자표 기준 마디 길이를 **초과**할 때만,
    `<dot>` 없는 쉼표 중 duration이 표준 길이의 1.5/1.75배(점이 duration에만
    반영된 OMR 오류)인 것을 기본 길이로 줄인다. 초과분 이상으로 줄이지 않으므로
    정상 악보는 건드리지 않는다. OSMD가 duration에서 점을 추론해 그리는
    "없던 점" 증상의 근본 대응.
    """
    ns = _ns(root)
    stats = {
        "restsFixed": 0,
        "measuresChanged": 0,
        "measuresOverfullLeft": 0,
        "restDisplayCleared": 0,
        "tupletStaccatoRemoved": 0,
    }
    for part in root.findall(_q(ns, "part")):
        divisions = 1
        beats = 4
        beat_type = 4
        for measure in part.findall(_q(ns, "measure")):
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
            measure_len = _measure_length_units(divisions, beats, beat_type)

            # 잇단음표 음에 붙은 "빔 쪽" 스타카토 제거 — Audiveris가 잇단 숫자(3)를
            # 스타카토 점으로도 오인하는 사례. 정상 스타카토는 음표 머리 쪽
            # (stem=up이면 below)에 붙으므로, stem과 같은 쪽 placement만 제거한다.
            for note in list_note_elements(measure, ns):
                if note.find(_q(ns, "time-modification")) is None:
                    continue
                stem_el = note.find(_q(ns, "stem"))
                stem = (stem_el.text or "").strip() if stem_el is not None and stem_el.text else ""
                if stem not in ("up", "down"):
                    continue
                beam_side = "above" if stem == "up" else "below"
                for notations in list(note.findall(_q(ns, "notations"))):
                    for arts in list(notations.findall(_q(ns, "articulations"))):
                        for art in list(arts):
                            if _local(art) == "staccato" and art.get("placement") == beam_side:
                                arts.remove(art)
                                stats["tupletStaccatoRemoved"] += 1
                        if len(arts) == 0:
                            notations.remove(arts)
                    if len(notations) == 0:
                        note.remove(notations)

            # 보이스별 길이 합 (화음 후속음·grace는 시간을 차지하지 않음)
            by_voice: dict[str, list[ET.Element]] = {}
            for note in list_note_elements(measure, ns):
                if note.find(_q(ns, "grace")) is not None:
                    continue
                if note.find(_q(ns, "chord")) is not None:
                    continue
                voice_el = note.find(_q(ns, "voice"))
                voice = (voice_el.text or "1").strip() if voice_el is not None and voice_el.text else "1"
                by_voice.setdefault(voice, []).append(note)

            measure_changed = False

            # 마디 전체 쉼표의 display-step/octave 힌트 제거 — Audiveris가 잘못 내보내면
            # 쉼표가 표준 위치(둘째줄 아래)가 아닌 엉뚱한 줄에 걸린다. 힌트를 지우면
            # 렌더러가 기본 위치에 그린다. (한 보이스가 통째로 쉬는 마디만 대상)
            for notes in by_voice.values():
                if not all(n.find(_q(ns, "rest")) is not None for n in notes):
                    continue
                for note in notes:
                    rest_el = note.find(_q(ns, "rest"))
                    if rest_el is None:
                        continue
                    type_el = note.find(_q(ns, "type"))
                    note_type = (
                        (type_el.text or "").strip() if type_el is not None and type_el.text else ""
                    )
                    if note_type not in ("whole", "") and rest_el.get("measure") != "yes":
                        continue
                    cleared = False
                    for tag in ("display-step", "display-octave"):
                        el = rest_el.find(_q(ns, tag))
                        if el is not None:
                            rest_el.remove(el)
                            cleared = True
                    if cleared:
                        stats["restDisplayCleared"] += 1
                        measure_changed = True

            for notes in by_voice.values():
                total = sum(_note_duration(n, ns) for n in notes)
                excess = total - measure_len
                if excess <= 0:
                    continue
                for note in notes:
                    if excess <= 0:
                        break
                    if note.find(_q(ns, "rest")) is None:
                        continue
                    if note.findall(_q(ns, "dot")):
                        continue  # 명시적 점은 실제 인쇄된 점일 수 있어 보존
                    current = _note_duration(note, ns)
                    if current <= 0:
                        continue
                    type_el = note.find(_q(ns, "type"))
                    note_type = (
                        (type_el.text or "").strip() if type_el is not None and type_el.text else ""
                    )
                    target: int | None = None
                    if note_type in ("whole", ""):
                        target = _undot_duration_guess(current, divisions, measure_len)
                        if target is None and current > measure_len:
                            target = measure_len
                    elif note_type:
                        base = _undotted_duration_for_type(note_type, divisions)
                        if base is not None and 0 < base < current:
                            target = base
                    if target is None or target >= current:
                        continue
                    reduction = current - target
                    if reduction > excess:
                        continue  # 초과분보다 크게 줄이면 마디가 모자라짐 — 건너뜀
                    dur_el = note.find(_q(ns, "duration"))
                    if dur_el is None:
                        continue
                    dur_el.text = str(target)
                    excess -= reduction
                    stats["restsFixed"] += 1
                    measure_changed = True
                if excess > 0:
                    stats["measuresOverfullLeft"] += 1
            if measure_changed:
                stats["measuresChanged"] += 1
    return stats


def normalize_rest_durations_file(mxl_path: Path) -> dict[str, Any]:
    files, root_path, root = load_mxl_root(mxl_path)
    stats = normalize_rest_durations_root(root)
    if stats["restsFixed"] > 0 or stats["restDisplayCleared"] > 0 or stats["tupletStaccatoRemoved"] > 0:
        write_mxl_root(mxl_path, files, root_path, root)
    return {"path": str(mxl_path), **stats}


def apply_fixes_to_root(root: ET.Element, fixes: list[dict[str, Any]]) -> dict[str, int]:
    ns = _ns(root)
    stats = {"applied": 0, "skipped": 0}
    touched: set[tuple[str, str]] = set()
    deferred_kinds = {
        "applyBeam",
        "removeBeam",
        "addTie",
        "removeTie",
        "applyTriplet",
        "removeTriplet",
    }
    deferred: list[dict[str, Any]] = []
    for fix in fixes:
        part_id = str(fix.get("partId") or "").strip()
        measure_mxl = str(fix.get("measureMxl") or "").strip()
        if part_id and measure_mxl:
            touched.add((part_id, measure_mxl))
        if fix.get("kind") in deferred_kinds:
            deferred.append(fix)
            continue
        if apply_fix(root, ns, fix):
            stats["applied"] += 1
        else:
            stats["skipped"] += 1
    for fix in deferred:
        if apply_fix(root, ns, fix):
            stats["applied"] += 1
        else:
            stats["skipped"] += 1
    for part_id, measure_mxl in touched:
        part = find_part(root, ns, part_id)
        if part is None:
            continue
        measure = find_measure(part, ns, measure_mxl)
        if measure is not None:
            _normalize_measure_note_engraving(part, ns, measure)
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
