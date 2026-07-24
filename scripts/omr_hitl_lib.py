#!/usr/bin/env python3
"""OMR HITL — 사람이 지정한 MusicXML 보정을 MXL에 적용."""
from __future__ import annotations

import copy
import io
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

_STEPS = ("C", "D", "E", "F", "G", "A", "B")
_DYNAMICS_TAGS = frozenset(
    {
        "p",
        "pp",
        "ppp",
        "pppp",
        "f",
        "ff",
        "fff",
        "ffff",
        "mp",
        "mf",
        "sf",
        "sfz",
        "fp",
        "rf",
        "fz",
        "sfp",
        "sfpp",
        "n",
        "pf",
        "sffz",
    }
)
_DEFAULT_DYNAMICS_PLACEMENT = "above"
_NAVIGATION_DIRECTION_TAGS = frozenset(
    {"segno", "coda", "fine", "dacapo", "dalsegno", "tocoda"}
)
_NAVIGATION_DIRECTION_LABELS = {
    "segno": "Segno",
    "coda": "Coda",
    "fine": "Fine",
    "dacapo": "D.C.",
    "dalsegno": "D.S.",
    "tocoda": "To Coda",
}
_ARTICULATION_TAGS = frozenset(
    {
        "accent",
        "strong-accent",
        "staccato",
        "tenuto",
        "staccatissimo",
        "marcato",
        "detached-legato",
        "spiccato",
        "breath-mark",
        "caesura",
    }
)


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


def first_score_part_id(root: ET.Element, ns: str) -> str | None:
    parts = root.findall(_q(ns, "part"))
    if not parts:
        return None
    pid = parts[0].get("id")
    return str(pid).strip() if pid else None


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


def _note_written_type(note: ET.Element, ns: str) -> str:
    type_el = note.find(_q(ns, "type"))
    if type_el is not None and type_el.text and type_el.text.strip():
        return type_el.text.strip()
    return "quarter"


def _note_dot_count(note: ET.Element, ns: str) -> int:
    return len(note.findall(_q(ns, "dot")))


def _type_weight_quarters(note_type: str, dot_count: int = 0) -> float:
    """음표 종류의 상대 박(4분=1) — 잇단 slot 가중치."""
    base = {
        "whole": 4.0,
        "half": 2.0,
        "quarter": 1.0,
        "eighth": 0.5,
        "16th": 0.25,
        "32nd": 0.125,
    }.get(note_type, 1.0)
    if dot_count == 1:
        base *= 1.5
    elif dot_count >= 2:
        base *= 1.75
    return base


def _tuplet_slot_weights(notes: list[ET.Element], indices: list[int], ns: str) -> list[float]:
    return [
        _type_weight_quarters(_note_written_type(notes[i], ns), _note_dot_count(notes[i], ns))
        for i in indices
    ]


def _smallest_written_type(types: list[str]) -> str:
    order = ["32nd", "64th", "16th", "eighth", "quarter", "half", "whole"]
    rank = {t: i for i, t in enumerate(order)}
    best = "quarter"
    best_rank = rank.get(best, 99)
    for t in types:
        r = rank.get(t, 99)
        if r < best_rank:
            best_rank = r
            best = t
    return best


def _distribute_tuplet_durations(total: int, weights: list[float]) -> list[int]:
    if total <= 0 or not weights:
        return []
    weight_sum = sum(weights)
    if weight_sum <= 0:
        per = max(1, total // len(weights))
        return [per] * len(weights)
    raw = [total * w / weight_sum for w in weights]
    out = [max(1, int(round(x))) for x in raw]
    diff = total - sum(out)
    if diff != 0:
        order = sorted(range(len(out)), key=lambda i: raw[i] - out[i], reverse=(diff > 0))
        step = 1 if diff > 0 else -1
        for i in order:
            if diff == 0:
                break
            nxt = out[i] + step
            if nxt >= 1:
                out[i] = nxt
                diff -= step
    return out


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


def _note_slur_flags(note: ET.Element, ns: str) -> tuple[bool, bool]:
    slur_start = False
    slur_stop = False
    notations = note.find(_q(ns, "notations"))
    if notations is None:
        return slur_start, slur_stop
    for slur in notations.findall(_q(ns, "slur")):
        t = (slur.get("type") or "").strip()
        if t == "start":
            slur_start = True
        elif t == "stop":
            slur_stop = True
    return slur_start, slur_stop


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
    slur_start, slur_stop = _note_slur_flags(note, ns)
    duration = None
    dur_el = note.find(_q(ns, "duration"))
    if dur_el is not None and dur_el.text and dur_el.text.strip().isdigit():
        duration = int(dur_el.text.strip())
    dot_count = len(note.findall(_q(ns, "dot")))
    note_type = (type_el.text or "").strip() if type_el is not None and type_el.text else None
    grace_el = note.find(_q(ns, "grace"))
    grace_slash = grace_el.get("slash") == "yes" if grace_el is not None else None
    time_mod = None
    tm_el = note.find(_q(ns, "time-modification"))
    if tm_el is not None:
        an = tm_el.find(_q(ns, "actual-notes"))
        nn = tm_el.find(_q(ns, "normal-notes"))
        if an is not None and an.text and nn is not None and nn.text:
            time_mod = f"{an.text.strip()}:{nn.text.strip()}"
    tuplet = None
    articulations: list[str] = []
    fermatas: list[str] = []
    for notations in note.findall(_q(ns, "notations")):
        for tup in notations.findall(_q(ns, "tuplet")):
            tuplet = tup.get("type") or tuplet
        for arts in notations.findall(_q(ns, "articulations")):
            for art in arts:
                name = _local(art)
                placement = art.get("placement")
                articulations.append(f"{name}({placement})" if placement else name)
        for ferm in notations.findall(_q(ns, "fermata")):
            ftype = (ferm.get("type") or "upright").strip() or "upright"
            placement = ferm.get("placement")
            fermatas.append(f"{ftype}({placement})" if placement else ftype)
    dx = _parse_default_x(note)
    return {
        "index": index,
        "elementKind": "note",
        "kind": "rest" if rest_el is not None else "note",
        "type": note_type,
        "duration": duration,
        "isDotted": dot_count > 0,
        "hasGrace": grace_el is not None,
        "graceSlash": grace_slash,
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
        "slurStart": slur_start,
        "slurStop": slur_stop,
        "beams": _note_beams(note, ns),
        "stem": (stem_el.text or "").strip() if stem_el is not None and stem_el.text else None,
        "timeMod": time_mod,
        "tuplet": tuplet,
        "articulations": articulations,
        "fermatas": fermatas,
        "defaultX": round(dx, 2) if dx is not None else None,
        "noteDirection": None,
        "noteDirections": None,
    }


def _directions_before_note(
    measure: ET.Element, note: ET.Element, ns: str
) -> list[ET.Element]:
    children = list(measure)
    try:
        ni = children.index(note)
    except ValueError:
        return []
    out: list[ET.Element] = []
    for j in range(ni - 1, -1, -1):
        c = children[j]
        if _local(c) == "direction":
            out.insert(0, c)
            continue
        if _local(c) == "note":
            break
    return out


def _note_direction_infos(
    measure: ET.Element, note: ET.Element, ns: str
) -> list[dict[str, Any]]:
    infos = [_direction_element_info(d, ns) for d in _directions_before_note(measure, note, ns)]
    from_notations = _read_note_direction_from_notations(note, ns)
    if from_notations is not None:
        infos.append(from_notations)
    return infos


def _is_navigation_direction_type(kind: str) -> bool:
    return (kind or "").strip().lower() in _NAVIGATION_DIRECTION_TAGS


def _direction_element_info(direction: ET.Element, ns: str) -> dict[str, Any]:
    dtype = direction.find(_q(ns, "direction-type"))
    if dtype is None:
        text = _direction_text(direction)
        return {"directionType": "words", "directionValue": text or ""}
    dyn = dtype.find(_q(ns, "dynamics"))
    if dyn is not None:
        tags = [_local(c) for c in dyn if _local(c) in _DYNAMICS_TAGS]
        if tags:
            pl = (dyn.get("placement") or direction.get("placement") or _DEFAULT_DYNAMICS_PLACEMENT).strip()
            out: dict[str, Any] = {"directionType": "dynamics", "directionValue": tags[0]}
            if pl in ("above", "below"):
                out["placement"] = pl
            return out
    for tag in _NAVIGATION_DIRECTION_TAGS:
        if dtype.find(_q(ns, tag)) is not None:
            pl = (direction.get("placement") or "").strip()
            out = {"directionType": tag, "directionValue": tag}
            if pl in ("above", "below"):
                out["placement"] = pl
            return out
    words = dtype.find(_q(ns, "words"))
    if words is not None and words.text and words.text.strip():
        return {"directionType": "words", "directionValue": words.text.strip()}
    reh = dtype.find(_q(ns, "rehearsal"))
    if reh is not None:
        return {"directionType": "rehearsal", "directionValue": (reh.text or "A").strip()}
    text = _direction_text(direction)
    return {"directionType": "words", "directionValue": text or ""}


def _read_note_direction_from_notations(note: ET.Element, ns: str) -> dict[str, Any] | None:
    for notations in note.findall(_q(ns, "notations")):
        dyn = notations.find(_q(ns, "dynamics"))
        if dyn is None:
            continue
        tags = [_local(c) for c in dyn if _local(c) in _DYNAMICS_TAGS]
        if tags:
            pl = (dyn.get("placement") or _DEFAULT_DYNAMICS_PLACEMENT).strip()
            out: dict[str, Any] = {"directionType": "dynamics", "directionValue": tags[0]}
            if pl in ("above", "below"):
                out["placement"] = pl
            return out
    return None


def _format_tempo_bpm_str(bpm: float) -> str:
    if bpm == int(bpm):
        return str(int(bpm))
    return str(bpm)


def _direction_has_tempo(direction: ET.Element, ns: str) -> bool:
    if direction.find(f".//{_q(ns, 'metronome')}") is not None:
        return True
    for sound in direction.findall(_q(ns, "sound")):
        if sound.get("tempo"):
            return True
    return False


def _beat_unit_from_tempo_direction(direction: ET.Element, ns: str) -> str:
    metro = direction.find(f".//{_q(ns, 'metronome')}")
    if metro is not None:
        beat = metro.find(_q(ns, "beat-unit"))
        if beat is not None and beat.text and beat.text.strip():
            return beat.text.strip()
    return "quarter"


def _parse_bpm_from_tempo_direction(direction: ET.Element, ns: str) -> float | None:
    for el in direction.iter():
        loc = _local(el)
        if loc == "per-minute" and el.text and el.text.strip():
            try:
                return float(el.text.strip())
            except ValueError:
                continue
        if loc == "sound" and el.get("tempo"):
            try:
                return float(str(el.get("tempo")).strip())
            except ValueError:
                continue
    return None


def _tempo_label(bpm: float | None, beat_unit: str) -> str:
    if bpm is None:
        return "tempo"
    bpm_i = int(bpm) if bpm == int(bpm) else bpm
    unit_sym = {"quarter": "♩", "half": "𝅗", "eighth": "♪"}.get(beat_unit, beat_unit)
    return f"{unit_sym}={bpm_i}"


def _build_tempo_direction(
    ns: str,
    bpm: float,
    beat_unit: str = "quarter",
    *,
    show_metronome: bool = True,
) -> ET.Element:
    bpm_str = _format_tempo_bpm_str(bpm)
    unit = (beat_unit or "quarter").strip() or "quarter"
    direction = ET.Element(_q(ns, "direction"))
    direction.set("placement", "above")
    if show_metronome:
        dtype = ET.SubElement(direction, _q(ns, "direction-type"))
        metro = ET.SubElement(dtype, _q(ns, "metronome"))
        metro.set("parentheses", "no")
        beat = ET.SubElement(metro, _q(ns, "beat-unit"))
        beat.text = unit
        pm = ET.SubElement(metro, _q(ns, "per-minute"))
        pm.text = bpm_str
    sound = ET.SubElement(direction, _q(ns, "sound"))
    sound.set("tempo", bpm_str)
    return direction


def _update_tempo_direction(
    direction: ET.Element,
    ns: str,
    bpm: float,
    beat_unit: str,
    *,
    show_metronome: bool,
) -> None:
    bpm_str = _format_tempo_bpm_str(bpm)
    unit = (beat_unit or "quarter").strip() or "quarter"
    metro = direction.find(f".//{_q(ns, 'metronome')}")
    if show_metronome:
        if metro is None:
            dtype = direction.find(_q(ns, "direction-type"))
            if dtype is None:
                dtype = ET.SubElement(direction, _q(ns, "direction-type"))
                direction.insert(0, dtype)
            metro = ET.SubElement(dtype, _q(ns, "metronome"))
            metro.set("parentheses", "no")
            ET.SubElement(metro, _q(ns, "beat-unit")).text = unit
            ET.SubElement(metro, _q(ns, "per-minute")).text = bpm_str
        else:
            beat = metro.find(_q(ns, "beat-unit"))
            if beat is None:
                beat = ET.SubElement(metro, _q(ns, "beat-unit"))
            beat.text = unit
            pm = metro.find(_q(ns, "per-minute"))
            if pm is None:
                pm = ET.SubElement(metro, _q(ns, "per-minute"))
            pm.text = bpm_str
    elif metro is not None:
        dtype = direction.find(_q(ns, "direction-type"))
        if dtype is not None:
            dtype.remove(metro)
            if len(dtype) == 0:
                direction.remove(dtype)
    sound = direction.find(_q(ns, "sound"))
    if sound is None:
        sound = ET.SubElement(direction, _q(ns, "sound"))
    sound.set("tempo", bpm_str)
    for el in direction.iter():
        if _local(el) == "per-minute" and el.text is not None:
            el.text = bpm_str


def _remove_tempo_directions_in_measure(
    measure: ET.Element, ns: str, direction_index: int | None = None
) -> bool:
    directions = measure.findall(_q(ns, "direction"))
    if direction_index is not None:
        if 0 <= direction_index < len(directions) and _direction_has_tempo(
            directions[direction_index], ns
        ):
            measure.remove(directions[direction_index])
            return True
        return False
    removed = False
    for direction in list(measure.findall(_q(ns, "direction"))):
        if _direction_has_tempo(direction, ns):
            measure.remove(direction)
            removed = True
    return removed


def _set_tempo_on_measure(
    measure: ET.Element,
    ns: str,
    bpm: float,
    beat_unit: str,
    *,
    show_metronome: bool,
    direction_index: int | None = None,
) -> bool:
    directions = measure.findall(_q(ns, "direction"))
    target: ET.Element | None = None
    if direction_index is not None and 0 <= direction_index < len(directions):
        cand = directions[direction_index]
        if _direction_has_tempo(cand, ns):
            target = cand
    if target is None:
        for direction in directions:
            if _direction_has_tempo(direction, ns):
                target = direction
                break
    if target is not None:
        _update_tempo_direction(target, ns, bpm, beat_unit, show_metronome=show_metronome)
        for direction in list(measure.findall(_q(ns, "direction"))):
            if direction is not target and _direction_has_tempo(direction, ns):
                measure.remove(direction)
        return True
    new_dir = _build_tempo_direction(ns, bpm, beat_unit, show_metronome=show_metronome)
    insert_at = 0
    for i, child in enumerate(measure):
        if _local(child) in ("note", "direction", "attributes", "forward", "backup"):
            insert_at = i
            break
        insert_at = i + 1
    measure.insert(insert_at, new_dir)
    return True


def _measure_tempo_snapshot(measure: ET.Element, ns: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for i, direction in enumerate(measure.findall(_q(ns, "direction"))):
        if not _direction_has_tempo(direction, ns):
            continue
        bpm = _parse_bpm_from_tempo_direction(direction, ns)
        beat = _beat_unit_from_tempo_direction(direction, ns)
        out.append(
            {
                "directionIndex": i,
                "tempoBpm": bpm,
                "beatUnit": beat,
                "label": _tempo_label(bpm, beat),
            }
        )
    return out


def _effective_tempo_bpm_before(
    root: ET.Element, ns: str, part_id: str, measure_mxl: str
) -> float | None:
    part = find_part(root, ns, part_id)
    if part is None:
        return None
    try:
        target_num = int(measure_mxl)
    except ValueError:
        return None
    tempo: float | None = None
    for measure in part.findall(_q(ns, "measure")):
        mnum = int(measure.get("number") or 0)
        if mnum >= target_num:
            break
        for direction in measure.findall(_q(ns, "direction")):
            bpm = _parse_bpm_from_tempo_direction(direction, ns)
            if bpm is not None:
                tempo = bpm
    return tempo


def _apply_measure_tempo_fix(root: ET.Element, ns: str, fix: dict[str, Any]) -> bool:
    kind = fix.get("kind")
    measure_mxl = str(fix.get("measureMxl") or "").strip()
    if not measure_mxl:
        return False
    parts = root.findall(_q(ns, "part"))
    if not parts:
        return False
    direction_index_raw = fix.get("directionIndex")
    direction_index: int | None = None
    if direction_index_raw is not None and direction_index_raw != "":
        try:
            direction_index = int(direction_index_raw)
        except (TypeError, ValueError):
            direction_index = None

    if kind == "removeMeasureTempo":
        changed = False
        for part in parts:
            measure = find_measure(part, ns, measure_mxl)
            if measure is None:
                continue
            if _remove_tempo_directions_in_measure(measure, ns, direction_index):
                changed = True
        return changed

    if kind == "setMeasureTempo":
        try:
            bpm = float(fix.get("tempoBpm") if fix.get("tempoBpm") is not None else fix.get("detail"))
        except (TypeError, ValueError):
            return False
        if not (1 <= bpm <= 400):
            return False
        beat_unit = str(fix.get("beatUnit") or "quarter").strip() or "quarter"
        changed = False
        for i, part in enumerate(parts):
            measure = find_measure(part, ns, measure_mxl)
            if measure is None:
                continue
            di = direction_index if i == 0 else None
            if _set_tempo_on_measure(
                measure,
                ns,
                bpm,
                beat_unit,
                show_metronome=(i == 0),
                direction_index=di,
            ):
                changed = True
        return changed

    return False


def _snapshot_timeline_sort_key(snap: dict[str, Any]) -> tuple[Any, ...]:
    staff = snap.get("staff") or 1
    dx = snap.get("timelineX")
    if dx is None:
        dx = snap.get("defaultX")
    x = dx if dx is not None else 1_000_000.0 + int(snap.get("index") or 0)
    return (staff, x, 0 if not snap.get("chord") else 1, snap.get("index") or 0)


def _measure_standalone_directions_snapshot(measure: ET.Element, ns: str) -> list[dict[str, Any]]:
    """마디 `<direction>` (템포 제외) — OCR 제목·마디번호 words 등 HITL 편집용."""
    out: list[dict[str, Any]] = []
    for i, direction in enumerate(measure.findall(_q(ns, "direction"))):
        if _direction_has_tempo(direction, ns):
            continue
        info = _direction_element_info(direction, ns)
        text = _direction_text(direction)
        dtype_kind = str(info.get("directionType") or "")
        if not text and not info.get("directionValue") and dtype_kind not in _NAVIGATION_DIRECTION_TAGS:
            continue
        staff_el = direction.find(_q(ns, "staff"))
        staff_n: int | None = None
        if staff_el is not None and staff_el.text and staff_el.text.strip().isdigit():
            staff_n = int(staff_el.text.strip())
        out.append(
            {
                "elementKind": "direction",
                "directionIndex": i,
                "text": text or str(info.get("directionValue") or ""),
                "directionType": info.get("directionType") or "words",
                "directionValue": info.get("directionValue") or text,
                "placement": (direction.get("placement") or "").strip() or None,
                "staff": staff_n,
            }
        )
    return out


def measure_elements_snapshot(measure: ET.Element, ns: str) -> list[dict[str, Any]]:
    elements: list[dict[str, Any]] = []
    note_index = 0
    for child in measure:
        local = _local(child)
        if local == "note":
            snap = note_snapshot(child, ns, note_index)
            infos = _note_direction_infos(measure, child, ns)
            if infos:
                snap["noteDirections"] = infos
                snap["noteDirection"] = infos[0]
            elements.append(snap)
            note_index += 1
    for i, snap in enumerate(elements):
        if snap.get("chord") and not snap.get("beams"):
            j = i - 1
            while j >= 0 and elements[j].get("chord"):
                j -= 1
            if j >= 0 and elements[j].get("beams"):
                snap["beams"] = list(elements[j]["beams"])
    for i, snap in enumerate(elements):
        if snap.get("chord"):
            j = i - 1
            while j >= 0 and elements[j].get("chord"):
                j -= 1
            leader_dx = elements[j].get("defaultX") if j >= 0 else None
        else:
            leader_dx = snap.get("defaultX")
        snap["timelineX"] = leader_dx
    elements.sort(key=_snapshot_timeline_sort_key)
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
    tempos = _measure_tempo_snapshot(measure, ns)
    effective = _effective_tempo_bpm_before(root, ns, part_id, measure_mxl)
    measure_directions = _measure_standalone_directions_snapshot(measure, ns)
    direction_source_part_id = part_id
    if not measure_directions and str(measure_mxl).strip() in ("0", "1"):
        first_pid = first_score_part_id(root, ns)
        if first_pid and first_pid != part_id:
            first_part = find_part(root, ns, first_pid)
            first_measure = find_measure(first_part, ns, measure_mxl) if first_part is not None else None
            if first_measure is not None:
                borrowed = _measure_standalone_directions_snapshot(first_measure, ns)
                if borrowed:
                    measure_directions = borrowed
                    direction_source_part_id = first_pid
    out: dict[str, Any] = {
        "partId": part_id,
        "measureMxl": str(measure_mxl),
        "notes": elements,
        "elements": elements,
        "tempos": tempos,
        "measureDirections": measure_directions,
        "effectiveTempoBpm": effective,
    }
    if direction_source_part_id != part_id:
        out["directionSourcePartId"] = direction_source_part_id
    return out


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


def _build_grace_note(
    ns: str,
    *,
    step: str,
    octave: int,
    alter: int | None,
    note_type: str,
    staff_n: int,
    voice: str,
    stem: str | None,
    slash: bool = True,
) -> ET.Element:
    """MusicXML grace note — duration 없음, `<grace/>`가 pitch 앞."""
    new_note = ET.Element(_q(ns, "note"))
    grace_el = ET.SubElement(new_note, _q(ns, "grace"))
    if slash:
        grace_el.set("slash", "yes")
    pitch_el = ET.SubElement(new_note, _q(ns, "pitch"))
    ET.SubElement(pitch_el, _q(ns, "step")).text = step
    ET.SubElement(pitch_el, _q(ns, "octave")).text = str(octave)
    if alter is not None:
        ET.SubElement(pitch_el, _q(ns, "alter")).text = str(int(alter))
    ET.SubElement(new_note, _q(ns, "voice")).text = voice
    ET.SubElement(new_note, _q(ns, "type")).text = note_type
    stem_val = stem if stem in ("up", "down") else _infer_stem_from_pitch(step, octave)
    ET.SubElement(new_note, _q(ns, "stem")).text = stem_val
    ET.SubElement(new_note, _q(ns, "staff")).text = str(staff_n)
    _sort_note_children(new_note, ns)
    return new_note


def _assign_grace_layout(new_note: ET.Element, principal: ET.Element) -> None:
    """꾸밈음 default-x — 본음보다 약간 왼쪽(timeline 정렬·OSMD 위치)."""
    fx = _parse_default_x(principal)
    if fx is not None:
        new_note.set("default-x", f"{max(fx - 12.0, 1.0):.2f}")
    else:
        new_note.set("default-x", "1.0")


def _build_inserted_rest_note(
    ns: str,
    *,
    rest_type: str,
    divisions: int,
    staff_n: int,
    voice: str,
    display_step: str = "B",
    display_octave: int = 4,
    dot_count: int = 0,
) -> ET.Element:
    new_note = ET.Element(_q(ns, "note"))
    rest_el = ET.SubElement(new_note, _q(ns, "rest"))
    target_dur = _duration_for_type_dots(rest_type, divisions, dot_count)
    if target_dur > 0:
        ET.SubElement(new_note, _q(ns, "duration")).text = str(target_dur)
    ET.SubElement(new_note, _q(ns, "voice")).text = voice
    ET.SubElement(new_note, _q(ns, "type")).text = rest_type
    for _ in range(dot_count):
        ET.SubElement(new_note, _q(ns, "dot"))
    if rest_type in ("whole", "half"):
        ET.SubElement(rest_el, _q(ns, "display-step")).text = display_step
        ET.SubElement(rest_el, _q(ns, "display-octave")).text = str(display_octave)
    ET.SubElement(new_note, _q(ns, "staff")).text = str(staff_n)
    return new_note


def _voice_default_for_staff(notes: list[ET.Element], ns: str, staff_n: int) -> str:
    """같은 staff에 이미 voice가 있으면 그 값, 없으면 staff 1→1·2+→5."""
    for note in notes:
        if (_note_staff_number(note, ns) or 1) != staff_n:
            continue
        voice_el = note.find(_q(ns, "voice"))
        if voice_el is not None and voice_el.text and voice_el.text.strip():
            return voice_el.text.strip()
    return "5" if staff_n >= 2 else "1"


def _normalize_measure_note_engraving(
    part: ET.Element, ns: str, measure: ET.Element
) -> bool:
    """HITL로 넣은 음·쉼표에 빠진 duration·voice·stem을 보강(일반 크기 렌더링)."""
    divisions, _, _ = _effective_divisions_and_time(part, ns, measure)
    notes = list_note_elements(measure, ns)
    if not notes:
        return False
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
        staff_n = _note_staff_number(note, ns) or 1
        fill_voice = _voice_default_for_staff(notes, ns, staff_n)
        voice_el = note.find(_q(ns, "voice"))
        if voice_el is None:
            voice_el = ET.SubElement(note, _q(ns, "voice"))
            voice_el.text = fill_voice
            changed = True
        elif not (voice_el.text or "").strip():
            voice_el.text = fill_voice
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


def _parse_default_x(note: ET.Element) -> float | None:
    raw = note.get("default-x")
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _assign_insert_layout_defaults(
    new_note: ET.Element,
    anchor: ET.Element | None,
    following: ET.Element | None = None,
    *,
    staff_notes: list[ET.Element] | None = None,
    ns: str = "",
) -> None:
    """HITL 삽입 음·쉼표에 default-x를 넣어 timeline 재정렬 시 맨 앞으로 가지 않게 한다."""
    x_val: float | None = None
    ax = _parse_default_x(anchor) if anchor is not None else None
    fx = _parse_default_x(following) if following is not None else None
    if ax is not None and fx is not None and fx > ax + 0.5:
        gap = fx - ax
        x_val = fx - 15.0 if gap > 20.0 else (ax + fx) / 2.0
    elif ax is not None:
        x_val = ax + 15.0
    if x_val is None and following is not None:
        fx = _parse_default_x(following)
        if fx is not None:
            x_val = fx - 15.0
    if x_val is None and staff_notes:
        best = 0.0
        found = False
        for n in staff_notes:
            if n.find(_q(ns, "chord")) is not None:
                continue
            nx = _parse_default_x(n)
            if nx is not None:
                best = max(best, nx)
                found = True
        if found:
            x_val = best + 15.0
    if x_val is None:
        x_val = 1.0
    new_note.set("default-x", f"{x_val:.2f}")


def _insert_note_element(
    measure: ET.Element,
    ns: str,
    new_el: ET.Element,
    after_note_index: int,
    staff_n: int | None = None,
    *,
    expand_chord_group: bool = True,
) -> None:
    """after_note_index=-1 이면 첫 note 앞; staff_n 지정 시 해당 staff 첫 note 앞."""
    children = list(measure)
    if after_note_index < 0:
        if staff_n is not None:
            for child in children:
                if _local(child) != "note":
                    continue
                if (_note_staff_number(child, ns) or 1) == staff_n:
                    measure.insert(children.index(child), new_el)
                    return
        for child in children:
            if _local(child) == "note":
                measure.insert(children.index(child), new_el)
                return
        measure.append(new_el)
        return
    seen = -1
    for child in children:
        if _local(child) != "note":
            continue
        seen += 1
        if seen == after_note_index:
            pos = children.index(child) + 1
            if expand_chord_group:
                while pos < len(children):
                    nxt = children[pos]
                    if _local(nxt) == "note" and nxt.find(_q(ns, "chord")) is not None:
                        pos += 1
                    else:
                        break
            measure.insert(pos, new_el)
            return
    measure.append(new_el)


def _insert_direction_at_staff_measure_start(
    measure: ET.Element, ns: str, new_dir: ET.Element, staff_n: int
) -> None:
    """마디 앞( afterNoteIndex=-1 ) — PL 등 staff≥2는 ⟨backup⟩ 직후(해당 줄 voice 시작)."""
    if staff_n >= 2:
        children = list(measure)
        for i, child in enumerate(children):
            if _local(child) != "backup":
                continue
            pos = i + 1
            while pos < len(children):
                nxt = children[pos]
                if _local(nxt) == "note" and (_note_staff_number(nxt, ns) or 1) == staff_n:
                    _attach_voice_to_direction_from_note(new_dir, ns, nxt)
                    measure.insert(pos, new_dir)
                    return
                if _local(nxt) == "note":
                    break
                pos += 1
            measure.insert(i + 1, new_dir)
            return
    _insert_note_element(measure, ns, new_dir, -1, staff_n=staff_n)


def _insert_before_note_element(
    measure: ET.Element,
    ns: str,
    new_el: ET.Element,
    before_note_index: int,
    staff_n: int | None = None,
) -> None:
    """before_note_index 음표 `<note>` 바로 앞 — 셈여림 등 해당 음 시작 시점."""
    children = list(measure)
    seen = -1
    for child in children:
        if _local(child) != "note":
            continue
        seen += 1
        if seen == before_note_index:
            measure.insert(children.index(child), new_el)
            return
    _insert_note_element(measure, ns, new_el, -1, staff_n=staff_n)


def _insert_context_notes(
    notes: list[ET.Element], ns: str, after_idx: int, staff_n: int
) -> tuple[ET.Element | None, ET.Element | None, list[ET.Element]]:
    """삽입 위치 anchor·다음 음, 같은 staff 음표 목록."""
    staff_notes = [
        n
        for n in notes
        if (_note_staff_number(n, ns) or 1) == staff_n and n.find(_q(ns, "chord")) is None
    ]
    anchor: ET.Element | None = None
    following: ET.Element | None = None
    if 0 <= after_idx < len(notes):
        anchor = notes[after_idx]
    if after_idx + 1 < len(notes):
        following = notes[after_idx + 1]
    return anchor, following, staff_notes


def _resolve_insert_after_context(
    notes: list[ET.Element], ns: str, after_idx: int, staff_n: int
) -> tuple[int, int, ET.Element | None, ET.Element | None, list[ET.Element]]:
    """「#n 뒤」삽입 — anchor staff·voice 상속, 화음 멤버면 그룹 끝 뒤, 다음 slice default-x."""
    if after_idx < 0 or after_idx >= len(notes):
        anchor, following, staff_notes = _insert_context_notes(notes, ns, after_idx, staff_n)
        return after_idx, staff_n, anchor, following, staff_notes
    anchor_note = notes[after_idx]
    staff_from = _note_staff_number(anchor_note, ns)
    if staff_from is not None:
        staff_n = staff_from
    leader_idx = _chord_leader_index(notes, ns, after_idx)
    insert_after_idx = _chord_group_end_index(notes, ns, leader_idx)
    anchor = notes[insert_after_idx]
    following: ET.Element | None = None
    for j in range(insert_after_idx + 1, len(notes)):
        n = notes[j]
        if (_note_staff_number(n, ns) or 1) != staff_n:
            continue
        following = n
        break
    staff_notes = [
        n
        for n in notes
        if (_note_staff_number(n, ns) or 1) == staff_n and n.find(_q(ns, "chord")) is None
    ]
    return insert_after_idx, staff_n, anchor, following, staff_notes


def _default_articulation_placement(note: ET.Element, ns: str) -> str | None:
    """표는 줄기 반대(음표 머리) 쪽 — stem up→below, stem down→above."""
    stem_el = note.find(_q(ns, "stem"))
    stem_dir = (stem_el.text or "").strip() if stem_el is not None and stem_el.text else ""
    if stem_dir == "up":
        return "below"
    if stem_dir == "down":
        return "above"
    return None


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


def _direction_staff_number(direction: ET.Element, ns: str) -> int | None:
    staff_el = direction.find(_q(ns, "staff"))
    if staff_el is not None and staff_el.text and staff_el.text.strip().isdigit():
        return int(staff_el.text.strip())
    return None


def _measure_staves_count(measure: ET.Element, ns: str) -> int:
    max_s = 1
    for attrs in measure.findall(_q(ns, "attributes")):
        st_el = attrs.find(_q(ns, "staves"))
        if st_el is not None and st_el.text and st_el.text.strip().isdigit():
            max_s = max(max_s, int(st_el.text.strip()))
    for note in measure.findall(_q(ns, "note")):
        s = _note_staff_number(note, ns)
        if s is not None:
            max_s = max(max_s, s)
    return max_s


def _part_staves_count(part: ET.Element, ns: str) -> int:
    max_s = 1
    for measure in part.findall(_q(ns, "measure")):
        max_s = max(max_s, _measure_staves_count(measure, ns))
    return max_s


def _parse_measure_number(measure_mxl: str) -> int | None:
    s = str(measure_mxl or "").strip()
    if not s.lstrip("-").isdigit():
        return None
    try:
        return int(s)
    except ValueError:
        return None


def _measure_list_index(part: ET.Element, ns: str, measure_mxl: str) -> int:
    target = str(measure_mxl).strip()
    for i, measure in enumerate(part.findall(_q(ns, "measure"))):
        if measure.get("number") == target:
            return i
    return -1


def _shift_measure_numbers(root: ET.Element, ns: str, threshold: int, delta: int, *, inclusive: bool) -> None:
    for part in root.findall(_q(ns, "part")):
        for measure in part.findall(_q(ns, "measure")):
            num = _parse_measure_number(measure.get("number") or "")
            if num is None:
                continue
            if inclusive:
                if num >= threshold:
                    measure.set("number", str(num + delta))
            elif num > threshold:
                measure.set("number", str(num + delta))


def _build_whole_measure_rest_note(
    ns: str,
    *,
    measure_len: int,
    staff_n: int,
    voice: str,
) -> ET.Element:
    note = ET.Element(_q(ns, "note"))
    rest_el = ET.SubElement(note, _q(ns, "rest"))
    rest_el.set("measure", "yes")
    ET.SubElement(note, _q(ns, "duration")).text = str(measure_len)
    ET.SubElement(note, _q(ns, "voice")).text = voice
    ET.SubElement(note, _q(ns, "type")).text = "whole"
    if staff_n > 1:
        ET.SubElement(note, _q(ns, "staff")).text = str(staff_n)
    return note


def _build_empty_measure_element(
    ns: str,
    number: str,
    *,
    divisions: int,
    beats: int,
    beat_type: int,
    staves_count: int,
) -> ET.Element:
    measure = ET.Element(_q(ns, "measure"))
    measure.set("number", number)
    measure_len = _measure_length_units(divisions, beats, beat_type)
    if staves_count <= 1:
        measure.append(
            _build_whole_measure_rest_note(ns, measure_len=measure_len, staff_n=1, voice="1")
        )
        return measure
    for staff_n in range(1, staves_count + 1):
        voice = "1" if staff_n == 1 else "5"
        if staff_n > 1:
            backup = ET.SubElement(measure, _q(ns, "backup"))
            ET.SubElement(backup, _q(ns, "duration")).text = str(measure_len)
        measure.append(
            _build_whole_measure_rest_note(
                ns, measure_len=measure_len, staff_n=staff_n, voice=voice
            )
        )
    return measure


def _insert_empty_measure(root: ET.Element, ns: str, anchor_mxl: str, position: str) -> bool:
    """모든 `<part>`에 동일 위치로 빈 마디(온쉼)를 삽입하고 이후 `measure@number`를 밀어 넣는다."""
    anchor_num = _parse_measure_number(anchor_mxl)
    if anchor_num is None:
        return False
    pos = (position or "").strip().lower()
    if pos not in ("before", "after"):
        return False

    parts = root.findall(_q(ns, "part"))
    if not parts:
        return False

    ref_part = parts[0]
    insert_idx = _measure_list_index(ref_part, ns, str(anchor_num))
    if insert_idx < 0:
        return False

    for part in parts[1:]:
        if _measure_list_index(part, ns, str(anchor_num)) != insert_idx:
            return False

    if pos == "before":
        _shift_measure_numbers(root, ns, anchor_num, 1, inclusive=True)
        new_number = str(anchor_num)
    else:
        _shift_measure_numbers(root, ns, anchor_num, 1, inclusive=False)
        insert_idx += 1
        new_number = str(anchor_num + 1)

    for part in parts:
        ref_measure = find_measure(part, ns, str(anchor_num))
        if ref_measure is None:
            measures = part.findall(_q(ns, "measure"))
            ref_measure = measures[min(insert_idx, len(measures) - 1)] if measures else None
        if ref_measure is None:
            return False
        divisions, beats, beat_type = _effective_divisions_and_time(part, ns, ref_measure)
        staves_count = _part_staves_count(part, ns)
        new_measure = _build_empty_measure_element(
            ns,
            new_number,
            divisions=divisions,
            beats=beats,
            beat_type=beat_type,
            staves_count=staves_count,
        )
        part.insert(insert_idx, new_measure)
    return True


def _bump_fix_measure_numbers(fix: dict[str, Any], anchor: int, position: str, delta: int = 1) -> None:
    for field in ("measureMxl", "toMeasureMxl", "fromMeasureMxl"):
        val = fix.get(field)
        if val is None or val == "":
            continue
        num = _parse_measure_number(str(val))
        if num is None:
            continue
        if position == "before":
            if num >= anchor:
                fix[field] = str(num + delta)
        elif num > anchor:
            fix[field] = str(num + delta)


def _first_note_on_staff(measure: ET.Element, ns: str, staff_n: int) -> ET.Element | None:
    for child in measure:
        if _local(child) == "note" and (_note_staff_number(child, ns) or 1) == staff_n:
            return child
    return None


def _note_matching_direction_voice(
    measure: ET.Element, direction: ET.Element, ns: str
) -> ET.Element | None:
    voice_el = direction.find(_q(ns, "voice"))
    if voice_el is None:
        for el in direction.iter():
            if _local(el) == "voice" and el.text and el.text.strip():
                voice_el = el
                break
    if voice_el is None or not voice_el.text or not voice_el.text.strip():
        return None
    want = voice_el.text.strip()
    dstaff = _direction_effective_staff(measure, direction, ns, 0)
    matches: list[ET.Element] = []
    for child in measure:
        if _local(child) != "note":
            continue
        v = child.find(_q(ns, "voice"))
        if v is None:
            for el in child:
                if _local(el) == "voice":
                    v = el
                    break
        if v is not None and (v.text or "").strip() == want:
            matches.append(child)
    if not matches:
        return None
    if dstaff >= 1:
        for child in matches:
            if (_note_staff_number(child, ns) or 1) == dstaff:
                return child
    return matches[0]


def _direction_effective_staff(
    measure: ET.Element, direction: ET.Element, ns: str, default: int = 1
) -> int:
    voice_el = direction.find(_q(ns, "voice"))
    if voice_el is None:
        for el in direction.iter():
            if _local(el) == "voice" and el.text and el.text.strip():
                voice_el = el
                break
    if voice_el is not None and voice_el.text and voice_el.text.strip().isdigit():
        want = voice_el.text.strip()
        for child in measure:
            if _local(child) != "note":
                continue
            v = child.find(_q(ns, "voice"))
            if v is None:
                for el in child:
                    if _local(el) == "voice":
                        v = el
                        break
            if v is not None and (v.text or "").strip() == want:
                return _note_staff_number(child, ns) or default
    dstaff = _direction_staff_number(direction, ns)
    return dstaff if dstaff is not None else default


def _direction_voice_text(direction: ET.Element, ns: str) -> str | None:
    voice_el = direction.find(_q(ns, "voice"))
    if voice_el is None:
        for el in direction.iter():
            if _local(el) == "voice" and el.text and el.text.strip():
                voice_el = el
                break
    if voice_el is None or not voice_el.text or not voice_el.text.strip():
        return None
    return voice_el.text.strip()


def _note_voice_text(note: ET.Element, ns: str) -> str | None:
    v = note.find(_q(ns, "voice"))
    if v is None:
        for el in note:
            if _local(el) == "voice":
                v = el
                break
    if v is None or not v.text or not v.text.strip():
        return None
    return v.text.strip()


def _anchor_note_for_direction(
    measure: ET.Element, direction: ET.Element, ns: str
) -> ET.Element | None:
    """Anchor = direction 바로 다음 `<note>`(HITL `#n` 붙임) 또는 동일 voice."""
    children = list(measure)
    try:
        idx = children.index(direction)
    except ValueError:
        return None
    want_voice = _direction_voice_text(direction, ns)
    staff_el = direction.find(_q(ns, "staff"))
    want_staff = int(staff_el.text.strip()) if (staff_el is not None and staff_el.text and staff_el.text.strip().isdigit()) else None

    if idx + 1 < len(children) and _local(children[idx + 1]) == "note":
        nxt = children[idx + 1]
        n_staff = _note_staff_number(nxt, ns) or 1
        if want_staff is None or n_staff == want_staff:
            if not want_voice:
                return nxt
            nv = _note_voice_text(nxt, ns)
            if not nv or nv == want_voice:
                return nxt
    if want_voice:
        for c in children:
            if _local(c) != "note":
                continue
            n_staff = _note_staff_number(c, ns) or 1
            if want_staff is None or n_staff == want_staff:
                if _note_voice_text(c, ns) == want_voice:
                    return c
    if want_staff is not None:
        return _first_note_on_staff(measure, ns, want_staff)
    return None


def _anchor_note_for_existing_direction(
    measure: ET.Element, direction: ET.Element, ns: str, staff_n: int
) -> ET.Element | None:
    return _anchor_note_for_direction(measure, direction, ns) or _first_note_on_staff(
        measure, ns, staff_n
    )


def _find_direction_anchor_note(
    measure: ET.Element,
    notes: list[ET.Element],
    ns: str,
    after_idx: int,
    staff_n: int,
) -> ET.Element | None:
    if 0 <= after_idx < len(notes):
        anchor_idx = after_idx
        if notes[after_idx].find(_q(ns, "chord")) is not None:
            anchor_idx = _chord_leader_index(notes, ns, after_idx)
        note = notes[anchor_idx]
        staff_from = _note_staff_number(note, ns)
        if staff_from is not None:
            staff_n = staff_from
        return note
    return _first_note_on_staff(measure, ns, staff_n)


def _note_dynamics_text(note: ET.Element, ns: str) -> str | None:
    for notations in note.findall(_q(ns, "notations")):
        dyn = notations.find(_q(ns, "dynamics"))
        if dyn is None:
            continue
        tags = [_local(c) for c in dyn if _local(c)]
        if tags:
            return "dyn:" + "+".join(tags)
    return None


def _attach_dynamics_to_note(
    note: ET.Element, ns: str, dyn_tag: str, placement: str | None = None
) -> None:
    tag = dyn_tag.lower()
    if tag not in _DYNAMICS_TAGS:
        tag = "p"
    notations = note.find(_q(ns, "notations"))
    if notations is None:
        notations = ET.SubElement(note, _q(ns, "notations"))
    existing = notations.find(_q(ns, "dynamics"))
    if existing is not None:
        notations.remove(existing)
    dyn = ET.SubElement(notations, _q(ns, "dynamics"))
    if placement in ("above", "below"):
        dyn.set("placement", placement)
    ET.SubElement(dyn, _q(ns, tag))
    _sort_note_children(note, ns)


def _remove_note_dynamics(note: ET.Element, ns: str, detail: str | None = None) -> bool:
    changed = False
    for notations in list(note.findall(_q(ns, "notations"))):
        dyn = notations.find(_q(ns, "dynamics"))
        if dyn is None:
            continue
        if detail:
            text = _note_dynamics_text(note, ns)
            want = _compact_text(detail)
            if text and want not in (_compact_text(text), want.replace("dyn:", "")):
                tags = [_local(c) for c in dyn if _local(c)]
                if want not in tags and f"dyn:{want}" != _compact_text(text or ""):
                    continue
        notations.remove(dyn)
        changed = True
        if not list(notations):
            note.remove(notations)
    if changed:
        _sort_note_children(note, ns)
    return changed


def _clear_note_direction(
    measure: ET.Element, notes: list[ET.Element], note_idx: int, ns: str
) -> bool:
    if note_idx < 0 or note_idx >= len(notes):
        return False
    note = notes[note_idx]
    changed = _remove_note_dynamics(note, ns, detail=None)
    children = list(measure)
    try:
        ni = children.index(note)
    except ValueError:
        return changed
    for j in range(ni - 1, -1, -1):
        c = children[j]
        if _local(c) == "direction":
            measure.remove(c)
            changed = True
            continue
        if _local(c) == "note":
            break
    return changed


def _apply_note_direction(
    measure: ET.Element,
    notes: list[ET.Element],
    note_idx: int,
    ns: str,
    direction_type: str,
    direction_value: str,
    placement: str | None = None,
) -> bool:
    if note_idx < 0 or note_idx >= len(notes):
        return False
    # _clear_note_direction(measure, notes, note_idx, ns)
    note = notes[note_idx]
    kind = (direction_type or "words").strip().lower()
    val = str(direction_value or "").strip()
    if kind == "dynamics":
        tag = val.lower() or "p"
        if placement is None:
            placement = _DEFAULT_DYNAMICS_PLACEMENT
        _attach_dynamics_to_note(note, ns, tag, placement)
        return True
    if not val and kind == "words":
        val = " "
    staff_n = _note_staff_number(note, ns)
    new_dir = _build_direction_element(
        ns,
        kind,
        val,
        staff_n=staff_n,
        placement=placement,
    )
    _insert_before_note_element(measure, ns, new_dir, note_idx)
    _attach_voice_to_direction_from_note(new_dir, ns, note)
    _copy_layout_from_note_to_direction(new_dir, note)
    return True


def _migrate_directions_to_notes(measure: ET.Element, ns: str) -> bool:
    """measure-level `<direction>` 을 anchor 음표 속성(notations·앞 direction)으로 통일."""
    changed = False
    for direction in list(measure.findall(_q(ns, "direction"))):
        anchor = _anchor_note_for_direction(measure, direction, ns)
        if anchor is None:
            continue
        dtype = direction.find(_q(ns, "direction-type"))
        dyn = dtype.find(_q(ns, "dynamics")) if dtype is not None else None
        if dyn is not None:
            tags = [_local(c) for c in dyn if _local(c) in _DYNAMICS_TAGS]
            if tags:
                placement = direction.get("placement") or dyn.get("placement") or _DEFAULT_DYNAMICS_PLACEMENT
                _attach_dynamics_to_note(anchor, ns, tags[0], placement)
                measure.remove(direction)
                changed = True
                continue

        # Ensure direction's staff matches the anchor note's staff
        astaff = _note_staff_number(anchor, ns)
        if astaff is not None:
            staff_el = direction.find(_q(ns, "staff"))
            if staff_el is None:
                staff_el = ET.Element(_q(ns, "staff"))
                staff_el.text = str(astaff)
                direction.append(staff_el)
                changed = True
            elif staff_el.text != str(astaff):
                staff_el.text = str(astaff)
                changed = True

        _attach_voice_to_direction_from_note(direction, ns, anchor)
        _copy_layout_from_note_to_direction(direction, anchor)
        children = list(measure)
        try:
            di = children.index(direction)
            ai = children.index(anchor)
        except ValueError:
            di, ai = -1, -1
        if ai == di + 1:
            continue
        measure.remove(direction)
        measure.insert(list(measure).index(anchor), direction)
        changed = True
    return changed


def _convert_multistaff_directions_to_note_attached(measure: ET.Element, ns: str) -> bool:
    return _migrate_directions_to_notes(measure, ns)


def _assign_timeline_attachment(
    measure: ET.Element,
    el: ET.Element,
    ns: str,
    last_seen_note: ET.Element | None,
    note_attachments: dict[ET.Element, list[ET.Element]],
    staff_preamble: dict[int, list[ET.Element]],
    start_elements: list[ET.Element],
) -> None:
    """direction staff ≠ 직전 note staff 이면 해당 staff 블록 앞(preamble)으로 — backup 뒤 PL 셈여림 등."""
    if _local(el) == "direction":
        dstaff = _direction_effective_staff(measure, el, ns, 1)
        if last_seen_note is not None:
            nstaff = _note_staff_number(last_seen_note, ns) or 1
            if dstaff == nstaff:
                note_attachments.setdefault(last_seen_note, []).append(el)
                return
        staff_preamble.setdefault(dstaff, []).append(el)
        return
    if last_seen_note is not None:
        note_attachments.setdefault(last_seen_note, []).append(el)
    else:
        start_elements.append(el)


def _try_preamble_direction_before_following_note(
    measure: ET.Element,
    direction: ET.Element,
    note_preamble: dict[ET.Element, list[ET.Element]],
) -> bool:
    """`<direction>` 바로 다음 `<note>` 앞 preamble — 화음 리더 직전 셈여림 등 timeline 재정렬 보존."""
    children = list(measure)
    try:
        idx = children.index(direction)
    except ValueError:
        return False
    for j in range(idx + 1, len(children)):
        if _local(children[j]) == "note":
            note_preamble.setdefault(children[j], []).append(direction)
            return True
    return False


def _find_note_by_pitch(
    notes: list[ET.Element],
    ns: str,
    step: str,
    octave: int,
    alter: int | None = None,
    *,
    staff: int | None = None,
    allow_chord: bool = False,
) -> ET.Element | None:
    """마디 내 pitch(·staff)로 음표 찾기 — 붙임줄 등 마디 넘김 연결용."""
    want_step = step.strip().upper()
    candidates: list[ET.Element] = []
    for note in notes:
        if not allow_chord and note.find(_q(ns, "chord")) is not None:
            continue
        key = _note_pitch_key(note, ns)
        if key is None:
            continue
        if key[0] != want_step or key[1] != octave:
            continue
        if alter is not None and key[2] != alter:
            continue
        if staff is not None:
            sn = _note_staff_number(note, ns)
            if sn is not None and sn != staff:
                continue
        candidates.append(note)
    if candidates:
        return candidates[0]
    if not allow_chord:
        return _find_note_by_pitch(
            notes, ns, step, octave, alter, staff=staff, allow_chord=True
        )
    return None


def _resolve_tie_endpoint_note(
    notes: list[ET.Element],
    ns: str,
    fix: dict[str, Any],
    *,
    prefix: str,
) -> ET.Element | None:
    """prefix=from|to — noteIndex 또는 pitchStep/Octave/Alter 로 음표 해석."""
    raw_idx = fix.get(f"{prefix}NoteIndex")
    if raw_idx is not None:
        try:
            idx = int(raw_idx)
        except (TypeError, ValueError):
            return None
        if 0 <= idx < len(notes):
            return notes[idx]
        return None
    step = str(fix.get(f"{prefix}PitchStep") or "").strip()
    if not step:
        return None
    try:
        octave = int(fix.get(f"{prefix}PitchOctave"))
    except (TypeError, ValueError):
        return None
    alter_n: int | None = None
    raw_alter = fix.get(f"{prefix}PitchAlter")
    if raw_alter is not None and raw_alter != "":
        try:
            alter_n = int(raw_alter)
        except (TypeError, ValueError):
            alter_n = None
    staff_raw = fix.get(f"{prefix}Staff") if prefix == "from" else fix.get("toStaff")
    staff_n: int | None = None
    if staff_raw is not None and staff_raw != "":
        try:
            staff_n = int(staff_raw)
        except (TypeError, ValueError):
            staff_n = None
    return _find_note_by_pitch(notes, ns, step, octave, alter_n, staff=staff_n)


def _note_voice_staff(note: ET.Element, ns: str) -> tuple[str, str]:
    voice_el = note.find(_q(ns, "voice"))
    staff_el = note.find(_q(ns, "staff"))
    voice = (voice_el.text or "1").strip() if voice_el is not None and voice_el.text else "1"
    staff = (staff_el.text or "1").strip() if staff_el is not None and staff_el.text else "1"
    return voice, staff


def _set_note_voice_staff(note: ET.Element, ns: str, voice: str, staff: str) -> None:
    voice_el = note.find(_q(ns, "voice"))
    if voice_el is None:
        voice_el = ET.SubElement(note, _q(ns, "voice"))
    voice_el.text = voice
    staff_el = note.find(_q(ns, "staff"))
    if staff_el is None:
        staff_el = ET.SubElement(note, _q(ns, "staff"))
    staff_el.text = staff


def _resolve_beam_endpoint(
    notes: list[ET.Element],
    ns: str,
    idx: int,
    pitch_hint: Any,
    staff_hint: Any = None,
) -> int:
    """UI #index 우선 — pitch 문자열(G4 vs G#4) 불일치로 끝점이 앞당겨지지 않게."""
    if idx < 0 or idx >= len(notes):
        return idx
    idx = _chord_leader_index(notes, ns, idx)

    def _staff_ok(note: ET.Element) -> bool:
        staff_want = str(staff_hint or "").strip()
        if not staff_want:
            return True
        _, staff = _note_voice_staff(note, ns)
        return staff == staff_want

    if _is_beamable_pitched_note(notes[idx], ns) and _staff_ok(notes[idx]):
        return idx

    hint = str(pitch_hint or "").strip()
    if not hint:
        return idx
    matches = [
        i
        for i, n in enumerate(notes)
        if _is_beamable_pitched_note(n, ns)
        and _note_pitch_str(n, ns) == hint
        and _staff_ok(n)
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
    if note.find(_q(ns, "grace")) is not None:
        return False
    if note.get("cue") == "yes":
        return False
    return True


def _beam_leader_indices_in_range(
    notes: list[ET.Element], ns: str, from_idx: int, to_idx: int
) -> list[int]:
    lo, hi = min(from_idx, to_idx), max(from_idx, to_idx)
    return [i for i in range(lo, hi + 1) if _is_beamable_pitched_note(notes[i], ns)]


def _extend_beam_leaders(
    notes: list[ET.Element], ns: str, leaders: list[int], expected: int
) -> list[int]:
    if expected < 2 or len(leaders) >= expected:
        return leaders
    out = list(leaders)
    idx = out[-1]
    while len(out) < expected and idx + 1 < len(notes):
        idx += 1
        if _is_beamable_pitched_note(notes[idx], ns):
            out.append(idx)
    return out


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


_NOTE_CHILD_ORDER = (
    "grace",
    "cue",
    "chord",
    "pitch",
    "unpitched",
    "rest",
    "duration",
    "tie",
    "instrument",
    "play",
    "voice",
    "type",
    "dot",
    "accidental",
    "time-modification",
    "stem",
    "notehead",
    "notehead-text",
    "staff",
    "beam",
    "notations",
    "lyric",
)


def _sort_note_children(note: ET.Element, ns: str) -> None:
    order_dict = {
        _q(ns, tag): idx for idx, tag in enumerate(_NOTE_CHILD_ORDER)
    }
    children = list(note)
    children.sort(key=lambda c: order_dict.get(c.tag, 999))
    note[:] = children


def _insert_beam_element(note: ET.Element, ns: str, beam_el: ET.Element) -> None:
    """MusicXML 순서: stem, notehead, staff, beam, notations — OSMD/VexFlow 호환."""
    note.append(beam_el)
    _sort_note_children(note, ns)


def _set_beam_on_note(note: ET.Element, ns: str, beam_number: int, value: str) -> None:
    if note.find(_q(ns, "rest")) is not None:
        return
    if note.find(_q(ns, "chord")) is not None:
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
    beam_el.set("number", str(beam_number))
    beam_el.text = value
    _insert_beam_element(note, ns, beam_el)


def _strip_chord_member_beams(notes: list[ET.Element], ns: str) -> bool:
    """OSMD/Audiveris 관례: `<chord/>` 멤버에는 `<beam>`을 두지 않는다."""
    changed = False
    for note in notes:
        if note.find(_q(ns, "chord")) is None:
            continue
        if _strip_beams_from_note(note, ns, None):
            changed = True
    return changed


def _chord_follower_indices(notes: list[ET.Element], ns: str, leader_idx: int) -> list[int]:
    out: list[int] = []
    for j in range(leader_idx + 1, len(notes)):
        if notes[j].find(_q(ns, "chord")) is not None:
            out.append(j)
        else:
            break
    return out


def _chord_leader_index(notes: list[ET.Element], ns: str, idx: int) -> int:
    while idx > 0 and notes[idx].find(_q(ns, "chord")) is not None:
        idx -= 1
    return idx


def _chord_group_end_index(notes: list[ET.Element], ns: str, leader_idx: int) -> int:
    end = leader_idx
    for j in _chord_follower_indices(notes, ns, leader_idx):
        end = j
    return end


def _chord_group_note_indices(notes: list[ET.Element], ns: str, idx: int) -> list[int]:
    leader_idx = _chord_leader_index(notes, ns, idx)
    return [leader_idx, *_chord_follower_indices(notes, ns, leader_idx)]


def _clone_time_modification_from_leader(leader: ET.Element, follower: ET.Element, ns: str) -> bool:
    src_tm = leader.find(_q(ns, "time-modification"))
    if src_tm is None:
        dst_tm = follower.find(_q(ns, "time-modification"))
        if dst_tm is not None:
            follower.remove(dst_tm)
            return True
        return False
    an = src_tm.find(_q(ns, "actual-notes"))
    nn = src_tm.find(_q(ns, "normal-notes"))
    nt = src_tm.find(_q(ns, "normal-type"))
    if an is None or nn is None or not (an.text or "").strip() or not (nn.text or "").strip():
        return False
    try:
        actual_notes = int(an.text.strip())
        normal_notes = int(nn.text.strip())
    except ValueError:
        return False
    normal_type = (nt.text or "quarter").strip() if nt is not None and nt.text else "quarter"
    dst_tm = follower.find(_q(ns, "time-modification"))
    if dst_tm is not None:
        dan = dst_tm.find(_q(ns, "actual-notes"))
        dnn = dst_tm.find(_q(ns, "normal-notes"))
        dnt = dst_tm.find(_q(ns, "normal-type"))
        dst_normal_type = (dnt.text or "quarter").strip() if dnt is not None and dnt.text else "quarter"
        if (
            dan is not None
            and dnn is not None
            and (dan.text or "").strip() == str(actual_notes)
            and (dnn.text or "").strip() == str(normal_notes)
            and dst_normal_type == normal_type
        ):
            return False
    _set_time_modification(follower, ns, actual_notes, normal_notes, normal_type)
    return True


def _sync_chord_followers_with_leader(
    notes: list[ET.Element], ns: str, leader_idx: int, *, strip_tuplet: bool = True
) -> bool:
    if leader_idx < 0 or leader_idx >= len(notes):
        return False
    leader = notes[leader_idx]
    if leader.find(_q(ns, "chord")) is not None:
        return False
    dur = _note_duration(leader, ns)
    type_el = leader.find(_q(ns, "type"))
    note_type = (type_el.text or "").strip() if type_el is not None and type_el.text else ""
    changed = False
    followers = _chord_follower_indices(notes, ns, leader_idx)
    if not followers:
        return False
    for fidx in followers:
        follower = notes[fidx]
        dur_el = follower.find(_q(ns, "duration"))
        if dur_el is None:
            dur_el = ET.SubElement(follower, _q(ns, "duration"))
        if (dur_el.text or "").strip() != str(dur):
            dur_el.text = str(dur)
            changed = True
        if note_type:
            ft = follower.find(_q(ns, "type"))
            if ft is None:
                ft = ET.SubElement(follower, _q(ns, "type"))
            if (ft.text or "").strip() != note_type:
                ft.text = note_type
                changed = True
        if _clone_time_modification_from_leader(leader, follower, ns):
            changed = True
        if strip_tuplet and _strip_tuplet_from_note(follower, ns, keep_time_mod=True):
            changed = True
    return changed


def _fix_chord_tag_consistency(notes: list[ET.Element], ns: str) -> bool:
    changed = False
    for grp in _chord_groups_in_order(notes, ns):
        leader = grp[0]
        chord_el = leader.find(_q(ns, "chord"))
        if chord_el is not None:
            leader.remove(chord_el)
            changed = True
        for mem in grp[1:]:
            if _ensure_chord_tag(mem, ns):
                changed = True
    return changed


def _sync_all_chord_groups(notes: list[ET.Element], ns: str) -> bool:
    changed = False
    for i, note in enumerate(notes):
        if note.find(_q(ns, "chord")) is not None:
            continue
        if _sync_chord_followers_with_leader(notes, ns, i):
            changed = True
    return changed


def _compact_default_x_by_staff(measure: ET.Element, ns: str) -> bool:
    """voice timeline 시작이 같은 음은 같은 default-x — 동시 시작(다른 박자·줄기) 정렬."""
    notes = list_note_elements(measure, ns)
    divisions = 1
    beats = 4
    beat_type = 4
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
    measure_len = max(1, _measure_length_units(divisions, beats, beat_type))
    changed = False
    base_x = 32.0
    span = 400.0
    for staff in ("1", "2"):
        timed = _staff_timed_leader_starts(measure, ns, staff)
        if not timed:
            continue
        for ni, start in timed:
            x = base_x + (start / measure_len * span)
            new_x = f"{x:.2f}"
            group = [notes[ni], *[notes[j] for j in _chord_follower_indices(notes, ns, ni)]]
            for note in group:
                if note.get("default-x") != new_x:
                    note.set("default-x", new_x)
                    changed = True
    return changed


def _compact_default_x_by_voice(measure: ET.Element, ns: str) -> bool:
    return _compact_default_x_by_staff(measure, ns)


def _merge_staff_voices_to_primary(measure: ET.Element, ns: str, staff: str) -> bool:
    notes = list_note_elements(measure, ns)
    voices: set[str] = set()
    for note in notes:
        if _is_grace_or_cue(note, ns):
            continue
        voice, st = _note_voice_staff(note, ns)
        if st == staff:
            voices.add(voice)
    if len(voices) <= 1:
        return False
    primary = sorted(voices, key=lambda v: int(v) if v.isdigit() else 999)[0]
    changed = False
    for note in notes:
        if _is_grace_or_cue(note, ns):
            continue
        voice, st = _note_voice_staff(note, ns)
        if st != staff or voice == primary:
            continue
        _set_note_voice_staff(note, ns, primary, staff)
        changed = True
    if not changed:
        return False
    start, end = _find_staff_block_span(measure, ns, staff)
    if start is not None and end is not None:
        for el in list(measure)[start : end + 1]:
            if _local(el) in ("backup", "forward"):
                measure.remove(el)
    return True


def _merge_staff_voices_if_non_overlapping(measure: ET.Element, ns: str, staff: str) -> bool:
    """Staff voice 병합 — 겹치지 않거나 same-x 잘못 분리된 sequential voice."""
    notes = list_note_elements(measure, ns)
    leaders: list[tuple[int, str, int, int]] = []
    voice_cursor: dict[str, int] = {}
    leader_indices: list[int] = []
    for i, note in enumerate(notes):
        if _is_grace_or_cue(note, ns) or note.find(_q(ns, "chord")) is not None:
            continue
        voice, st = _note_voice_staff(note, ns)
        if st != staff:
            continue
        leader_indices.append(i)
        start = voice_cursor.get(voice, 0)
        dur = _note_duration(note, ns)
        leaders.append((i, voice, start, start + dur))
        voice_cursor[voice] = start + dur
    voices = {v for _, v, _, _ in leaders}
    if len(voices) <= 1:
        return False
    intervals_by_voice: dict[str, list[tuple[int, int]]] = {}
    for _i, voice, start, end in leaders:
        intervals_by_voice.setdefault(voice, []).append((start, end))
    voice_list = sorted(voices, key=lambda v: int(v) if v.isdigit() else 999)
    for a in range(len(voice_list)):
        for b in range(a + 1, len(voice_list)):
            for sa, ea in intervals_by_voice.get(voice_list[a], []):
                for sb, eb in intervals_by_voice.get(voice_list[b], []):
                    if max(sa, sb) < min(ea, eb):
                        return False
    leader_xs = [_parse_default_x(notes[i]) for i in leader_indices]
    distinct_x = {round(x, 0) for x in leader_xs if x is not None}
    if len(distinct_x) >= len(voices):
        return _merge_staff_voices_to_primary(measure, ns, staff)
    for i in range(len(leader_indices) - 1):
        a = notes[leader_indices[i]]
        b = notes[leader_indices[i + 1]]
        va, _ = _note_voice_staff(a, ns)
        vb, _ = _note_voice_staff(b, ns)
        if va != vb:
            xa = _parse_default_x(a) or 0.0
            xb = _parse_default_x(b) or 0.0
            if abs(xa - xb) <= _SAME_X_TOLERANCE:
                return _merge_staff_voices_to_primary(measure, ns, staff)
    return _merge_staff_voices_to_primary(measure, ns, staff)


def _note_pitch_key(note: ET.Element, ns: str) -> tuple[str, int, int] | None:
    pitch_el = note.find(_q(ns, "pitch"))
    if pitch_el is None:
        return None
    step_el = pitch_el.find(_q(ns, "step"))
    oct_el = pitch_el.find(_q(ns, "octave"))
    if step_el is None or oct_el is None or not step_el.text or not oct_el.text:
        return None
    step = step_el.text.strip()
    try:
        octave = int(oct_el.text.strip())
    except ValueError:
        return None
    alter_el = pitch_el.find(_q(ns, "alter"))
    alter = 0
    if alter_el is not None and alter_el.text and alter_el.text.strip().lstrip("-").isdigit():
        alter = int(alter_el.text.strip())
    return (step, octave, alter)


def _copy_note_child(new_note: ET.Element, leader: ET.Element, ns: str, local: str) -> None:
    src = leader.find(_q(ns, local))
    if src is None:
        return
    dst = ET.SubElement(new_note, _q(ns, local))
    dst.text = src.text
    dst.tail = src.tail
    for key, val in src.attrib.items():
        dst.set(key, val)


def _build_chord_member_from_leader(
    ns: str,
    leader: ET.Element,
    *,
    step: str,
    octave: int,
    alter: int | None,
) -> ET.Element:
    """리더와 같은 시점·박자·voice·stem으로 `<chord/>` 멤버 생성."""
    new_note = ET.Element(_q(ns, "note"))
    if leader.get("default-x"):
        new_note.set("default-x", leader.get("default-x"))
    ET.SubElement(new_note, _q(ns, "chord"))
    pitch_el = ET.SubElement(new_note, _q(ns, "pitch"))
    ET.SubElement(pitch_el, _q(ns, "step")).text = step
    ET.SubElement(pitch_el, _q(ns, "octave")).text = str(octave)
    if alter is not None and alter != 0:
        ET.SubElement(pitch_el, _q(ns, "alter")).text = str(int(alter))
    for tag in ("duration", "voice", "type", "stem", "staff"):
        _copy_note_child(new_note, leader, ns, tag)
    for _ in leader.findall(_q(ns, "dot")):
        ET.SubElement(new_note, _q(ns, "dot"))
    tm = leader.find(_q(ns, "time-modification"))
    if tm is not None:
        new_note.append(copy.deepcopy(tm))
    return new_note


def _ensure_short_type_for_beam(
    note: ET.Element, ns: str, divisions: int, prefer: str = "eighth"
) -> None:
    """빔 연결 대상 박자·duration을 맞춰 OSMD가 빔을 그리게 한다."""
    if note.find(_q(ns, "rest")) is not None or note.find(_q(ns, "pitch")) is None:
        return
    type_el = note.find(_q(ns, "type"))
    note_type = (type_el.text or "").strip() if type_el is not None and type_el.text else ""
    dot_count = len(note.findall(_q(ns, "dot")))
    short_types = ("eighth", "16th", "32nd", "64th", "128th")
    if note_type in short_types:
        target_type = note_type
    else:
        target_type = prefer if note_type in ("quarter", "half", "whole", "") else prefer
        if type_el is None:
            type_el = ET.SubElement(note, _q(ns, "type"))
        type_el.text = target_type
    target_dur = _duration_for_type_dots(target_type, divisions, dot_count)
    if target_dur <= 0:
        return
    dur_el = note.find(_q(ns, "duration"))
    if dur_el is None:
        dur_el = ET.SubElement(note, _q(ns, "duration"))
    if (dur_el.text or "").strip() != str(target_dur):
        dur_el.text = str(target_dur)


def _set_note_stem(note: ET.Element, ns: str, stem: str) -> None:
    if stem not in ("up", "down"):
        return
    stem_el = note.find(_q(ns, "stem"))
    if stem_el is None:
        stem_el = ET.SubElement(note, _q(ns, "stem"))
    stem_el.text = stem


def _note_beam_value(note: ET.Element, ns: str, beam_number: int = 1) -> str | None:
    for beam in note.findall(_q(ns, "beam")):
        try:
            n = int(beam.get("number") or "1")
        except ValueError:
            n = 1
        if n == beam_number and beam.text:
            return beam.text.strip()
    return None


def _apply_beam_to_range(
    notes: list[ET.Element],
    ns: str,
    indices: list[int],
    beam_number: int = 1,
    divisions: int = 0,
) -> bool:
    if not indices:
        return False
    lo, hi = min(indices), max(indices)
    pitched = [
        i
        for i in indices
        if 0 <= i < len(notes) and _is_beamable_pitched_note(notes[i], ns)
    ]
    if len(pitched) < 2:
        return False
    for idx in pitched:
        if not _is_short_beamable_type(_note_written_type(notes[idx], ns)):
            return False

    leader_voice, leader_staff = _note_voice_staff(notes[pitched[0]], ns)
    leader_stem_el = notes[pitched[0]].find(_q(ns, "stem"))
    leader_stem = (
        (leader_stem_el.text or "").strip().lower()
        if leader_stem_el is not None and leader_stem_el.text
        else ""
    )

    for idx in range(lo, hi + 1):
        if not (0 <= idx < len(notes)):
            continue
        note = notes[idx]
        if note.find(_q(ns, "rest")) is not None or note.find(_q(ns, "pitch")) is None:
            continue
        _set_note_voice_staff(note, ns, leader_voice, leader_staff)
        if leader_stem in ("up", "down"):
            _set_note_stem(note, ns, leader_stem)
        if note.find(_q(ns, "chord")) is None:
            for fidx in _chord_follower_indices(notes, ns, idx):
                _set_note_voice_staff(notes[fidx], ns, leader_voice, leader_staff)
                if leader_stem in ("up", "down"):
                    _set_note_stem(notes[fidx], ns, leader_stem)

    if divisions > 0:
        for idx in pitched:
            _ensure_short_type_for_beam(notes[idx], ns, divisions)
            for fidx in _chord_follower_indices(notes, ns, idx):
                _ensure_short_type_for_beam(notes[fidx], ns, divisions)

    for idx in range(lo, hi + 1):
        if not (0 <= idx < len(notes)):
            continue
        _strip_beams_from_note(notes[idx], ns, beam_number)
        for fidx in _chord_follower_indices(notes, ns, idx):
            _strip_beams_from_note(notes[fidx], ns, beam_number)

    for pos, idx in enumerate(pitched):
        if pos == 0:
            val = "begin"
        elif pos == len(pitched) - 1:
            val = "end"
        else:
            val = "continue"
        _set_beam_on_note(notes[idx], ns, beam_number, val)
    first_beam = _note_beam_value(notes[pitched[0]], ns, beam_number)
    last_beam = _note_beam_value(notes[pitched[-1]], ns, beam_number)
    return first_beam == "begin" and last_beam == "end"


def _strip_tuplet_from_note(note: ET.Element, ns: str, *, keep_time_mod: bool = False) -> bool:
    changed = False
    if not keep_time_mod:
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


def _note_has_tuplet_type(note: ET.Element, ns: str, tuplet_type: str) -> bool:
    for notations in note.findall(_q(ns, "notations")):
        for tup in notations.findall(_q(ns, "tuplet")):
            if (tup.get("type") or "").strip() == tuplet_type:
                return True
    return False


def _tuplet_notation_runs(notes: list[ET.Element], ns: str) -> list[tuple[int, int]]:
    """리더 index 기준 tuplet start~stop 구간."""
    rhythmic = _rhythmic_indices_in_range(notes, ns, 0, len(notes) - 1)
    runs: list[tuple[int, int]] = []
    active: int | None = None
    for idx in rhythmic:
        note = notes[idx]
        if _note_has_tuplet_type(note, ns, "start"):
            active = idx
        if _note_has_tuplet_type(note, ns, "stop") and active is not None:
            runs.append((active, idx))
            active = None
    return runs


def _tuplet_span_for_note(notes: list[ET.Element], ns: str, idx: int) -> tuple[int, int] | None:
    leader = _chord_leader_index(notes, ns, idx)
    for start, stop in _tuplet_notation_runs(notes, ns):
        if start <= leader <= stop:
            return start, stop
    tm = notes[leader].find(_q(ns, "time-modification"))
    if tm is None:
        return None
    an = tm.find(_q(ns, "actual-notes"))
    nn = tm.find(_q(ns, "normal-notes"))
    if an is None or nn is None or not (an.text or "").strip() or not (nn.text or "").strip():
        return None
    key = f"{an.text.strip()}:{nn.text.strip()}"
    rhythmic = _rhythmic_indices_in_range(notes, ns, 0, len(notes) - 1)
    pos = rhythmic.index(leader) if leader in rhythmic else -1
    if pos < 0:
        return None
    start_pos = pos
    while start_pos > 0:
        prev = notes[rhythmic[start_pos - 1]]
        ptm = prev.find(_q(ns, "time-modification"))
        if ptm is None:
            break
        pan = ptm.find(_q(ns, "actual-notes"))
        pnn = ptm.find(_q(ns, "normal-notes"))
        if pan is None or pnn is None:
            break
        if f"{(pan.text or '').strip()}:{(pnn.text or '').strip()}" != key:
            break
        start_pos -= 1
    end_pos = pos
    while end_pos + 1 < len(rhythmic):
        nxt = notes[rhythmic[end_pos + 1]]
        ntm = nxt.find(_q(ns, "time-modification"))
        if ntm is None:
            break
        nan = ntm.find(_q(ns, "actual-notes"))
        nnn = ntm.find(_q(ns, "normal-notes"))
        if nan is None or nnn is None:
            break
        if f"{(nan.text or '').strip()}:{(nnn.text or '').strip()}" != key:
            break
        end_pos += 1
    return rhythmic[start_pos], rhythmic[end_pos]


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


_SHORT_BEAM_TYPES = frozenset({"eighth", "16th", "32nd", "64th", "128th", "256th"})


def _is_short_beamable_type(note_type: str) -> bool:
    return (note_type or "").strip() in _SHORT_BEAM_TYPES


def _tuplet_group_has_beam(notes: list[ET.Element], indices: list[int], ns: str) -> bool:
    """구간에 `<beam>` 태그가 하나라도 있으면 True (레거시)."""
    for i in indices:
        if notes[i].find(_q(ns, "beam")) is not None:
            return True
        notations = notes[i].find(_q(ns, "notations"))
        if notations is not None and notations.findall(_q(ns, "beam")):
            return True
    return False


def _tuplet_group_has_connected_beam(
    notes: list[ET.Element], indices: list[int], ns: str
) -> bool:
    """리더 음표가 begin→continue*→end로 실제 빔 run을 이루고, 모두 8분 이하일 때만 True."""
    leaders = [i for i in indices if not _is_chord_member_note(notes[i], ns)]
    if len(leaders) < 2:
        return False
    for i in leaders:
        if not _is_short_beamable_type(_note_written_type(notes[i], ns)):
            return False
    beam_vals = [_note_beam_value(notes[i], ns) for i in leaders]
    if not any(beam_vals):
        return False
    if beam_vals[0] != "begin" or beam_vals[-1] != "end":
        return False
    for mid in beam_vals[1:-1]:
        if mid not in ("continue", "end"):
            return False
    return True


def _tuplet_span_needs_bracket(
    notes: list[ET.Element], indices: list[int], ns: str, *, preserve_types: bool = False
) -> bool:
    """2분+4분 혼합 등 — bracket 필수(빔으로 대체 불가)."""
    if preserve_types:
        return True
    types = {_note_written_type(notes[i], ns) for i in indices}
    return any(not _is_short_beamable_type(t) for t in types)


def _tuplet_show_bracket(
    has_rest: bool, has_connected_beam: bool, *, needs_bracket: bool = False
) -> bool:
    """빔·쉼표 없는 잇단(4분 세잇단 등)은 숫자 3 좌우 bracket 필요."""
    if needs_bracket:
        return True
    return has_rest or not has_connected_beam


def _is_chord_member_note(note: ET.Element, ns: str) -> bool:
    return note.find(_q(ns, "chord")) is not None


def _rhythmic_indices_in_range(
    notes: list[ET.Element], ns: str, from_idx: int, to_idx: int
) -> list[int]:
    """화음·grace·cue 제외 — 세잇단 actual-notes 카운트용."""
    out: list[int] = []
    for i in range(from_idx, to_idx + 1):
        if i < 0 or i >= len(notes):
            continue
        note = notes[i]
        if note.find(_q(ns, "grace")) is not None:
            continue
        if note.get("cue") == "yes":
            continue
        if _is_chord_member_note(note, ns):
            continue
        out.append(i)
    return out


def _infer_tuplet_placement(note: ET.Element, ns: str) -> str:
    """세잇단 bracket·숫자 placement — 빔 쪽(stem down → below, stem up → above). fix_audiveris_mxl과 동일."""
    stem_el = note.find(_q(ns, "stem"))
    stem = (stem_el.text or "").strip().lower() if stem_el is not None and stem_el.text else ""
    if stem == "down":
        return "below"
    if stem == "up":
        return "above"
    return "above"


def _infer_tuplet_placement_for_range(
    notes: list[ET.Element], indices: list[int], ns: str
) -> str:
    """쉼표로 시작하는 세잇단은 같은 구간 음표 stem·빔 방향으로 bracket·숫자 placement."""
    below_count = 0
    above_count = 0
    for idx in indices:
        note = notes[idx]
        if note.find(_q(ns, "rest")) is not None and note.find(_q(ns, "pitch")) is None:
            continue
        plc = _infer_tuplet_placement(note, ns)
        if plc == "below":
            below_count += 1
        else:
            above_count += 1
    if below_count > above_count:
        return "below"
    if above_count > below_count:
        return "above"
    for idx in indices:
        note = notes[idx]
        if note.find(_q(ns, "pitch")) is not None:
            return _infer_tuplet_placement(note, ns)
    return "above"


def _apply_triplet_to_range(
    notes: list[ET.Element],
    ns: str,
    indices: list[int],
    divisions: int,
    actual_notes: int,
    normal_notes: int,
    normal_type: str,
    *,
    preserve_types: bool = False,
) -> bool:
    if len(indices) < 2 or actual_notes < 2 or normal_notes < 1:
        return False
    normal_dur = _duration_for_type_dots(normal_type, divisions, 0)
    if normal_dur <= 0:
        return False
    total = normal_dur * normal_notes
    slot_weights = _tuplet_slot_weights(notes, indices, ns)
    if preserve_types:
        weight_sum = sum(slot_weights)
        if weight_sum <= 0:
            return False
        actual_notes = max(2, int(round(weight_sum)))
        per_durs = _distribute_tuplet_durations(total, slot_weights)
    else:
        per_note = max(1, total // actual_notes)
        per_durs = [per_note] * len(indices)
    has_rest = _tuplet_group_has_rest(notes, indices, ns)
    needs_bracket = _tuplet_span_needs_bracket(
        notes, indices, ns, preserve_types=preserve_types
    )
    has_connected_beam = _tuplet_group_has_connected_beam(notes, indices, ns)
    show_bracket = _tuplet_show_bracket(
        has_rest, has_connected_beam, needs_bracket=needs_bracket
    )
    if needs_bracket or not has_connected_beam:
        for idx in indices:
            for note_idx in [idx, *_chord_follower_indices(notes, ns, idx)]:
                _strip_beams_from_note(notes[note_idx], ns)
    placement = _infer_tuplet_placement_for_range(notes, indices, ns)
    changed = False
    for pos, idx in enumerate(indices):
        note = notes[idx]
        if note.find(_q(ns, "rest")) is not None and note.find(_q(ns, "pitch")) is None:
            pass
        if not preserve_types:
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
        per_note = per_durs[pos] if pos < len(per_durs) else per_durs[-1]
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
            if show_bracket:
                tuplet.set("show-bracket", "yes")
                tuplet.set("bracket", "yes")
                tuplet.set("placement", placement)
            else:
                tuplet.set("show-bracket", "no")
                tuplet.set("bracket", "no")
                tuplet.set("placement", placement)
            changed = True
        elif pos == len(indices) - 1:
            ET.SubElement(notations, _q(ns, "tuplet"), {"type": "stop"})
            changed = True
        if _sync_chord_followers_with_leader(notes, ns, idx):
            changed = True
    return changed


def nudge_display_step(step: str, octave: int, line_delta: int) -> tuple[str, int]:
    """오선에서 한 줄(line_delta=1은 아래쪽 줄) 이동."""
    base = _diatonic_index(step, octave)
    return _from_diatonic_index(base + line_delta * 2)


def _direction_text(direction: ET.Element) -> str:
    parts: list[str] = []
    for el in direction.iter():
        loc = _local(el)
        if loc == "dynamics":
            tags = [_local(c) for c in el if _local(c)]
            if tags:
                parts.append("dyn:" + "+".join(tags))
        elif loc in ("words", "text", "syllable", "rehearsal"):
            if el.text and el.text.strip():
                parts.append(el.text.strip())
        elif loc in _NAVIGATION_DIRECTION_TAGS:
            parts.append(_NAVIGATION_DIRECTION_LABELS.get(loc, loc))
        elif loc == "wedge" and el.get("type"):
            parts.append(f"wedge({el.get('type')})")
        elif loc == "pedal" and el.get("type"):
            parts.append(f"pedal({el.get('type')})")
        elif loc == "metronome":
            for child in el:
                if _local(child) == "per-minute" and child.text:
                    parts.append(f"♩={child.text.strip()}")
    return " ".join(parts).strip()


def _direction_is_spurious(direction: ET.Element, ns: str, detail: str | None = None) -> bool:
    text = _direction_text(direction)
    if _is_spurious_detail(text, detail):
        return True
    want = _compact_text(detail or "")
    for dtype in direction.findall(_q(ns, "direction-type")):
        dyn = dtype.find(_q(ns, "dynamics"))
        if dyn is None:
            continue
        tags = [_local(c) for c in dyn if _local(c)]
        other = [_local(c) for c in dtype if _local(c) != "dynamics"]
        if other:
            continue
        if len(tags) == 1 and tags[0].lower() in ("p", "pp", "ppp"):
            if not detail:
                return True
            if want in (tags[0].lower(), _compact_text(text), f"dyn:{tags[0].lower()}"):
                return True
    return False


def _note_voice_number(note: ET.Element, ns: str) -> int | None:
    voice_el = note.find(_q(ns, "voice"))
    if voice_el is not None and voice_el.text and voice_el.text.strip().isdigit():
        return int(voice_el.text.strip())
    return None


def _attach_voice_to_direction_from_note(
    direction: ET.Element, ns: str, note: ET.Element | None
) -> None:
    if note is None or direction.find(_q(ns, "voice")) is not None:
        return
    voice_n = _note_voice_number(note, ns)
    if voice_n is not None:
        ET.SubElement(direction, _q(ns, "voice")).text = str(voice_n)


def _copy_layout_from_note_to_direction(direction: ET.Element, note: ET.Element) -> None:
    for attr in ("default-x", "default-y"):
        val = note.get(attr)
        if val:
            direction.set(attr, val)


def _bind_direction_voice_from_staff(
    measure: ET.Element, ns: str, direction: ET.Element, staff_n: int
) -> None:
    """PL 등 staff≥2 direction — OSMD 미리보기·MuseScore voice 연결."""
    if staff_n < 2 or direction.find(_q(ns, "voice")) is not None:
        return
    children = list(measure)
    try:
        idx = children.index(direction)
    except ValueError:
        return
    for j in range(idx + 1, len(children)):
        nxt = children[j]
        if _local(nxt) == "note" and (_note_staff_number(nxt, ns) or 1) == staff_n:
            _attach_voice_to_direction_from_note(direction, ns, nxt)
            return
    for j in range(idx - 1, -1, -1):
        prv = children[j]
        if _local(prv) == "note" and (_note_staff_number(prv, ns) or 1) == staff_n:
            _attach_voice_to_direction_from_note(direction, ns, prv)
            return


def _build_direction_element(
    ns: str,
    direction_type: str,
    value: str,
    *,
    staff_n: int | None = None,
    voice_n: int | None = None,
    placement: str | None = None,
) -> ET.Element:
    direction = ET.Element(_q(ns, "direction"))
    if placement in ("above", "below"):
        direction.set("placement", placement)
    dtype = ET.SubElement(direction, _q(ns, "direction-type"))
    kind = (direction_type or "words").strip().lower()
    val = str(value or "").strip()
    if kind == "dynamics":
        tag = val.lower() or "p"
        if tag not in _DYNAMICS_TAGS:
            tag = "p"
        dyn = ET.SubElement(dtype, _q(ns, "dynamics"))
        ET.SubElement(dyn, _q(ns, tag))
    elif kind == "rehearsal":
        el = ET.SubElement(dtype, _q(ns, "rehearsal"))
        el.text = val or "A"
    elif kind in _NAVIGATION_DIRECTION_TAGS:
        ET.SubElement(dtype, _q(ns, kind))
        if placement is None:
            placement = "above"
    else:
        el = ET.SubElement(dtype, _q(ns, "words"))
        el.text = val or " "
    if voice_n is not None:
        ET.SubElement(direction, _q(ns, "voice")).text = str(voice_n)
    if staff_n is not None:
        staff_el = ET.SubElement(direction, _q(ns, "staff"))
        staff_el.text = str(staff_n)
    return direction


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
    if re.fullmatch(r"dyn:[pP]{1,3}(?:\+.*)?", compact or ""):
        return True
    return False


def apply_fix(root: ET.Element, ns: str, fix: dict[str, Any]) -> bool:
    kind = fix.get("kind")
    part_id = str(fix.get("partId") or "").strip()
    measure_mxl = str(fix.get("measureMxl") or "").strip()
    if not part_id or not measure_mxl:
        return False

    if kind in ("setMeasureTempo", "removeMeasureTempo"):
        return _apply_measure_tempo_fix(root, ns, fix)

    if kind == "insertEmptyMeasureBefore":
        return _insert_empty_measure(root, ns, measure_mxl, "before")
    if kind == "insertEmptyMeasureAfter":
        return _insert_empty_measure(root, ns, measure_mxl, "after")

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
            if _direction_is_spurious(direction, ns, str(detail) if detail else None):
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
            group_indices = _chord_group_note_indices(notes, ns, idx)
            group = [notes[i] for i in group_indices]
            for el in group:
                measure.remove(el)
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
        attached_raw = fix.get("attachedToNoteIndex")
        if attached_raw is not None:
            try:
                note_idx = int(attached_raw)
            except (TypeError, ValueError):
                return False
            notes = list_note_elements(measure, ns)
            if 0 <= note_idx < len(notes) and _remove_note_dynamics(
                notes[note_idx], ns, str(fix.get("detail") or "") or None
            ):
                return True
            return False
        try:
            direction_index = int(fix.get("directionIndex"))
        except (TypeError, ValueError):
            return False
        directions = measure.findall(_q(ns, "direction"))
        if 0 <= direction_index < len(directions):
            measure.remove(directions[direction_index])
            return True
        return False

    if kind == "setMeasureDirectionText":
        try:
            direction_index = int(fix.get("directionIndex"))
        except (TypeError, ValueError):
            return False
        new_text = str(fix.get("text") or fix.get("directionValue") or fix.get("detail") or "").strip()
        directions = measure.findall(_q(ns, "direction"))
        if not (0 <= direction_index < len(directions)):
            return False
        direction = directions[direction_index]
        dtype = direction.find(_q(ns, "direction-type"))
        if dtype is None:
            dtype = ET.SubElement(direction, _q(ns, "direction-type"))
        words = dtype.find(_q(ns, "words"))
        reh = dtype.find(_q(ns, "rehearsal"))
        target = words if words is not None else reh
        if target is None:
            words = ET.SubElement(dtype, _q(ns, "words"))
            target = words
        target.text = new_text
        return True

    if kind == "clearNoteDirection":
        try:
            note_idx = int(fix.get("noteIndex"))
        except (TypeError, ValueError):
            return False
        return _clear_note_direction(measure, notes, note_idx, ns)

    if kind in ("setNoteDirection", "addNoteDirection"):
        direction_type = str(fix.get("directionType") or "words").strip().lower()
        direction_value = str(fix.get("directionValue") or fix.get("detail") or "").strip()
        try:
            note_idx = int(fix.get("noteIndex"))
        except (TypeError, ValueError):
            return False
        if note_idx < 0 or note_idx >= len(notes):
            return False
        placement = str(fix.get("placement") or "").strip().lower() or None
        if placement not in ("above", "below", ""):
            placement = None
        if direction_type == "dynamics" and placement is None:
            placement = _DEFAULT_DYNAMICS_PLACEMENT
        return _apply_note_direction(
            measure, notes, note_idx, ns, direction_type, direction_value, placement
        )

    if kind == "removeNoteDirection":
        direction_type = str(fix.get("directionType") or "words").strip().lower()
        direction_value = str(fix.get("directionValue") or fix.get("detail") or "").strip()
        try:
            note_idx = int(fix.get("noteIndex"))
        except (TypeError, ValueError):
            return False
        if note_idx < 0 or note_idx >= len(notes):
            return False
        note = notes[note_idx]
        changed = False
        
        if direction_type == "dynamics":
            tag = direction_value.lower() or "p"
            changed = _remove_note_dynamics(note, ns, detail=tag)
        else:
            children = list(measure)
            try:
                ni = children.index(note)
            except ValueError:
                return changed
            for j in range(ni - 1, -1, -1):
                c = children[j]
                if _local(c) == "direction":
                    dtype = c.find(_q(ns, "direction-type"))
                    if dtype is not None:
                        mark = dtype.find(_q(ns, direction_type))
                        if mark is not None and (mark.text or "").strip() == direction_value:
                            measure.remove(c)
                            changed = True
                            break
                if _local(c) == "note":
                    break
        return changed

    if kind == "insertDirection":
        direction_type = str(fix.get("directionType") or "words").strip().lower()
        direction_value = str(fix.get("directionValue") or fix.get("detail") or "").strip()
        try:
            staff_n = int(fix.get("staff", 1))
            after_idx = int(fix.get("afterNoteIndex", -1))
        except (TypeError, ValueError):
            return False
        placement = str(fix.get("placement") or "").strip().lower() or None
        if placement not in ("above", "below", ""):
            placement = None
        if _is_navigation_direction_type(direction_type):
            if placement is None:
                placement = "above"
            new_dir = _build_direction_element(
                ns,
                direction_type,
                direction_value or direction_type,
                staff_n=staff_n,
                placement=placement,
            )
            if after_idx < 0:
                _insert_direction_at_staff_measure_start(measure, ns, new_dir, staff_n)
            elif fix.get("afterRest") and 0 <= after_idx < len(notes):
                _insert_before_note_element(measure, ns, new_dir, after_idx, staff_n=staff_n)
            else:
                _insert_note_element(
                    measure,
                    ns,
                    new_dir,
                    after_idx,
                    staff_n=staff_n,
                    expand_chord_group=False,
                )
            _bind_direction_voice_from_staff(measure, ns, new_dir, staff_n)
            return True
        if direction_type == "dynamics" and placement is None:
            placement = _DEFAULT_DYNAMICS_PLACEMENT
        note_idx: int | None
        if 0 <= after_idx < len(notes):
            note_idx = after_idx
            if notes[after_idx].find(_q(ns, "chord")) is not None:
                note_idx = _chord_leader_index(notes, ns, after_idx)
        else:
            anchor = _first_note_on_staff(measure, ns, staff_n)
            note_idx = notes.index(anchor) if anchor is not None else None
        if note_idx is None:
            return False
        return _apply_note_direction(
            measure, notes, note_idx, ns, direction_type, direction_value, placement
        )

    if kind == "insertGraceNote":
        step = str(fix.get("pitchStep") or "").strip()
        if not step:
            return False
        try:
            before_idx = int(fix.get("beforeNoteIndex", fix.get("noteIndex", -1)))
            octave = int(fix.get("pitchOctave"))
        except (TypeError, ValueError):
            return False
        if before_idx < 0 or before_idx >= len(notes):
            return False
        before_idx = _chord_leader_index(notes, ns, before_idx)
        principal = notes[before_idx]
        if principal.find(_q(ns, "rest")) is not None or principal.find(_q(ns, "grace")) is not None:
            return False
        staff_n = _note_staff_number(principal, ns) or int(fix.get("staff") or 1)
        note_type = str(fix.get("noteType") or "eighth").strip()
        if note_type not in ("eighth", "16th", "32nd", "64th"):
            note_type = "eighth"
        slash = fix.get("graceSlash")
        slash_b = True if slash is None else bool(slash)
        alter = fix.get("pitchAlter")
        alter_n: int | None = None
        if alter is not None and alter != "":
            try:
                alter_n = int(alter)
            except (TypeError, ValueError):
                alter_n = None
        insert_after_idx = before_idx - 1
        if insert_after_idx >= 0:
            insert_after_idx, staff_n, _, _, _ = _resolve_insert_after_context(
                notes, ns, insert_after_idx, staff_n
            )
        voice, stem = _infer_voice_stem_from_neighbors(notes, ns, before_idx, staff_n)
        new_note = _build_grace_note(
            ns,
            step=step,
            octave=octave,
            alter=alter_n,
            note_type=note_type,
            staff_n=staff_n,
            voice=voice,
            stem=stem,
            slash=slash_b,
        )
        _assign_grace_layout(new_note, principal)
        _insert_note_element(measure, ns, new_note, insert_after_idx, staff_n=staff_n)
        return True

    if kind == "removeGraceBeforeNote":
        try:
            before_idx = int(fix.get("beforeNoteIndex", fix.get("noteIndex", -1)))
        except (TypeError, ValueError):
            return False
        if before_idx <= 0 or before_idx >= len(notes):
            return False
        before_idx = _chord_leader_index(notes, ns, before_idx)
        to_remove: list[ET.Element] = []
        i = before_idx - 1
        while i >= 0 and notes[i].find(_q(ns, "grace")) is not None:
            to_remove.append(notes[i])
            i -= 1
        if not to_remove:
            return False
        for note in to_remove:
            measure.remove(note)
        return True

    if kind == "repairParallelOnsets":
        try:
            staff = str(int(fix.get("staff", 1)))
        except (TypeError, ValueError):
            staff = "1"
        return _repair_parallel_onsets_on_staff(measure, ns, str(staff))

    if kind == "linkParallelOnsets":
        try:
            staff = str(int(fix.get("staff", 1)))
        except (TypeError, ValueError):
            staff = "1"
        raw_indices = fix.get("parallelNoteIndices")
        indices: list[int] = []
        if isinstance(raw_indices, list):
            for item in raw_indices:
                try:
                    indices.append(int(item))
                except (TypeError, ValueError):
                    continue
        elif raw_indices is not None:
            try:
                indices.append(int(raw_indices))
            except (TypeError, ValueError):
                pass
        if len(indices) < 2:
            detail = str(fix.get("detail") or "").strip()
            if detail:
                for part in detail.split(","):
                    part = part.strip().lstrip("#")
                    if part.isdigit():
                        indices.append(int(part))
        return _link_parallel_onsets_by_indices(measure, ns, staff, indices)

    if kind == "addArticulation":
        try:
            idx = int(fix.get("noteIndex"))
        except (TypeError, ValueError):
            return False
        if idx < 0 or idx >= len(notes):
            return False
        art = str(fix.get("articulation") or "accent").strip().lower()
        if art not in _ARTICULATION_TAGS:
            return False
        note = notes[idx]
        if note.find(_q(ns, "rest")) is not None:
            return False
        notations = _ensure_notations(note, ns)
        arts = notations.find(_q(ns, "articulations"))
        if arts is None:
            arts = ET.SubElement(notations, _q(ns, "articulations"))
        for existing in arts:
            if _local(existing) == art:
                return False
        art_el = ET.SubElement(arts, _q(ns, art))
        placement = str(fix.get("placement") or "").strip().lower()
        if placement in ("above", "below"):
            art_el.set("placement", placement)
        else:
            auto = _default_articulation_placement(note, ns)
            if auto:
                art_el.set("placement", auto)
        return True

    if kind == "addFermata":
        try:
            idx = int(fix.get("noteIndex"))
        except (TypeError, ValueError):
            return False
        if idx < 0 or idx >= len(notes):
            return False
        note = notes[idx]
        fermata_type = str(fix.get("fermataType") or "upright").strip().lower()
        if fermata_type not in ("upright", "inverted"):
            fermata_type = "upright"
        notations = _ensure_notations(note, ns)
        for existing in notations.findall(_q(ns, "fermata")):
            return False
        ferm_el = ET.SubElement(notations, _q(ns, "fermata"))
        ferm_el.set("type", fermata_type)
        placement = str(fix.get("placement") or "").strip().lower()
        if placement in ("above", "below"):
            ferm_el.set("placement", placement)
        else:
            stem_el = note.find(_q(ns, "stem"))
            stem = (stem_el.text or "").strip().lower() if stem_el is not None and stem_el.text else ""
            if stem == "up":
                ferm_el.set("placement", "below")
            elif stem == "down":
                ferm_el.set("placement", "above")
        return True

    if kind == "removeFermata":
        try:
            idx = int(fix.get("noteIndex"))
        except (TypeError, ValueError):
            return False
        if idx < 0 or idx >= len(notes):
            return False
        note = notes[idx]
        want = str(fix.get("fermataType") or "").strip().lower() or None
        removed = False
        for notations in list(note.findall(_q(ns, "notations"))):
            for ferm in list(notations.findall(_q(ns, "fermata"))):
                ftype = (ferm.get("type") or "upright").strip().lower()
                if want and ftype != want:
                    continue
                notations.remove(ferm)
                removed = True
            if len(notations) == 0:
                note.remove(notations)
        return removed

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
        to_measure_mxl = str(fix.get("toMeasureMxl") or measure_mxl).strip()
        from_measure = measure
        from_notes = notes
        to_part = part
        if to_measure_mxl != measure_mxl:
            to_measure = find_measure(part, ns, to_measure_mxl)
            if to_measure is None:
                return False
            to_notes = list_note_elements(to_measure, ns)
        else:
            to_measure = measure
            to_notes = notes

        from_note = _resolve_tie_endpoint_note(from_notes, ns, fix, prefix="from")
        to_note = _resolve_tie_endpoint_note(to_notes, ns, fix, prefix="to")
        if from_note is None or to_note is None:
            return False
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

    if kind == "removeSlur":
        try:
            idx = int(fix.get("noteIndex"))
        except (TypeError, ValueError):
            return False
        if idx < 0 or idx >= len(notes):
            return False
        which = str(fix.get("slurEnd") or "both").strip().lower()
        note = notes[idx]
        notations = note.find(_q(ns, "notations"))
        if notations is None:
            return False
        removed = False
        for slur in list(notations.findall(_q(ns, "slur"))):
            t = (slur.get("type") or "").strip()
            if which == "both" or which == t:
                notations.remove(slur)
                removed = True
        if not list(notations):
            note.remove(notations)
        return removed

    if kind == "addSlur":
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

        # Find unused slur number
        existing_numbers = set()
        for n in notes:
            for notations_el in n.findall(_q(ns, "notations")):
                for slur in notations_el.findall(_q(ns, "slur")):
                    num = slur.get("number")
                    if num and num.isdigit():
                        existing_numbers.add(int(num))
        new_num = 1
        while new_num in existing_numbers:
            new_num += 1

        def get_placement(n_el):
            stem_el = n_el.find(_q(ns, "stem"))
            stem_dir = (stem_el.text or "").strip() if stem_el is not None else ""
            if stem_dir == "down":
                return "above"
            return "below"

        plc_from = get_placement(from_note)
        plc_to = get_placement(to_note)

        start = ET.SubElement(from_not, _q(ns, "slur"))
        start.set("type", "start")
        start.set("number", str(new_num))
        if plc_from:
            start.set("placement", plc_from)
            stem_dir = (from_note.find(_q(ns, "stem")).text or "").strip() if from_note.find(_q(ns, "stem")) is not None else ""
            if plc_from == "below":
                start.set("default-y", "-35" if stem_dir == "up" else "-25")
            else:
                start.set("default-y", "35" if stem_dir == "up" else "25")

        stop = ET.SubElement(to_not, _q(ns, "slur"))
        stop.set("type", "stop")
        stop.set("number", str(new_num))
        if plc_to:
            stop.set("placement", plc_to)
            stem_dir = (to_note.find(_q(ns, "stem")).text or "").strip() if to_note.find(_q(ns, "stem")) is not None else ""
            if plc_to == "below":
                stop.set("default-y", "-35" if stem_dir == "up" else "-25")
            else:
                stop.set("default-y", "35" if stem_dir == "up" else "25")

        return True

    if kind == "insertRest":
        rest_type = str(fix.get("noteType") or fix.get("restType") or "quarter").strip()
        dot_count = 0
        if fix.get("dotCount") is not None:
            try:
                dot_count = max(0, min(2, int(fix.get("dotCount"))))
            except (TypeError, ValueError):
                dot_count = 0
        try:
            staff_n = int(fix.get("staff", 1))
            after_idx = int(fix.get("afterNoteIndex", -1))
        except (TypeError, ValueError):
            return False
        divisions, _beats, _bt = _effective_divisions_and_time(part, ns, measure)
        insert_after_idx, staff_n, anchor, following, staff_notes = _resolve_insert_after_context(
            notes, ns, after_idx, staff_n
        )
        voice, _stem = _infer_voice_stem_from_neighbors(notes, ns, insert_after_idx, staff_n)
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
            dot_count=dot_count,
        )
        _assign_insert_layout_defaults(
            new_note, anchor, following, staff_notes=staff_notes, ns=ns
        )
        _insert_note_element(measure, ns, new_note, insert_after_idx, staff_n=staff_n)
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
        dot_count = 0
        if fix.get("dotCount") is not None:
            try:
                dot_count = max(0, min(2, int(fix.get("dotCount"))))
            except (TypeError, ValueError):
                dot_count = 0
        divisions, _beats, _bt = _effective_divisions_and_time(part, ns, measure)
        insert_after_idx, staff_n, anchor, following, staff_notes = _resolve_insert_after_context(
            notes, ns, after_idx, staff_n
        )
        voice, stem = _infer_voice_stem_from_neighbors(notes, ns, insert_after_idx, staff_n)
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
            dot_count=dot_count,
        )
        _assign_insert_layout_defaults(
            new_note, anchor, following, staff_notes=staff_notes, ns=ns
        )
        _insert_note_element(measure, ns, new_note, insert_after_idx, staff_n=staff_n)
        _normalize_measure_note_engraving(part, ns, measure)
        return True

    if kind == "insertChordMember":
        step = str(fix.get("pitchStep") or "").strip()
        if not step:
            return False
        try:
            leader_idx = int(fix.get("leaderNoteIndex", fix.get("noteIndex", -1)))
            octave = int(fix.get("pitchOctave"))
        except (TypeError, ValueError):
            return False
        if leader_idx < 0 or leader_idx >= len(notes):
            return False
        leader_idx = _chord_leader_index(notes, ns, leader_idx)
        leader = notes[leader_idx]
        if leader.find(_q(ns, "pitch")) is None:
            return False
        alter = fix.get("pitchAlter")
        alter_n: int | None = None
        if alter is not None and alter != "":
            try:
                alter_n = int(alter)
            except (TypeError, ValueError):
                alter_n = None
        new_key = (step, octave, alter_n or 0)
        group_indices = [leader_idx, *_chord_follower_indices(notes, ns, leader_idx)]
        for gi in group_indices:
            key = _note_pitch_key(notes[gi], ns)
            if key is not None and (key[0], key[1], key[2]) == new_key:
                return False
        new_note = _build_chord_member_from_leader(
            ns, leader, step=step, octave=octave, alter=alter_n
        )
        end_idx = _chord_group_end_index(notes, ns, leader_idx)
        leader_staff = _note_staff_number(leader, ns) or 1
        _insert_note_element(measure, ns, new_note, end_idx, staff_n=leader_staff)
        notes_after = list_note_elements(measure, ns)
        _strip_chord_member_beams(notes_after, ns)
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
        preserve_types = bool(fix.get("preserveNoteTypes"))
        if from_idx < 0 or to_idx < from_idx or to_idx >= len(notes):
            return False
        from_idx = _chord_leader_index(notes, ns, from_idx)
        indices = _rhythmic_indices_in_range(notes, ns, from_idx, to_idx)
        if len(indices) < 2:
            return False
        written_types = [_note_written_type(notes[i], ns) for i in indices]
        if preserve_types:
            normal_type = _smallest_written_type(written_types + [normal_type])
        try:
            actual_notes_req = int(fix.get("actualNotes", len(indices)))
        except (TypeError, ValueError):
            actual_notes_req = len(indices)
        if preserve_types:
            slot_weights = _tuplet_slot_weights(notes, indices, ns)
            actual_notes = max(2, int(round(sum(slot_weights))))
        elif actual_notes_req >= 2 and len(indices) > actual_notes_req:
            indices = indices[:actual_notes_req]
            actual_notes = len(indices)
        else:
            actual_notes = len(indices)
        divisions, _beats, _bt = _effective_divisions_and_time(part, ns, measure)
        return _apply_triplet_to_range(
            notes,
            ns,
            indices,
            divisions,
            actual_notes,
            normal_notes,
            normal_type,
            preserve_types=preserve_types,
        )

    if kind == "removeTriplet":
        try:
            idx = int(fix.get("fromNoteIndex"))
        except (TypeError, ValueError):
            return False
        if idx < 0 or idx >= len(notes):
            return False
        span = _tuplet_span_for_note(notes, ns, idx)
        if span is not None:
            from_idx, to_idx = span
        else:
            try:
                from_idx = int(fix.get("fromNoteIndex"))
                to_idx = int(fix.get("toNoteIndex"))
            except (TypeError, ValueError):
                return False
            if from_idx < 0 or to_idx < from_idx or to_idx >= len(notes):
                return False
            from_idx = _chord_leader_index(notes, ns, from_idx)
            to_idx = _chord_leader_index(notes, ns, to_idx)
            to_idx = _chord_group_end_index(notes, ns, to_idx)
        changed = False
        indices = _rhythmic_indices_in_range(notes, ns, from_idx, to_idx)
        divisions, _beats, _bt = _effective_divisions_and_time(part, ns, measure)
        for idx in indices:
            for note_idx in [idx, *_chord_follower_indices(notes, ns, idx)]:
                if _strip_tuplet_from_note(notes[note_idx], ns):
                    changed = True
            note = notes[idx]
            type_el = note.find(_q(ns, "type"))
            note_type = (type_el.text or "").strip() if type_el is not None and type_el.text else "eighth"
            dot_count = len(note.findall(_q(ns, "dot")))
            target_dur = _duration_for_type_dots(note_type, divisions, dot_count)
            if target_dur > 0:
                dur_el = note.find(_q(ns, "duration"))
                if dur_el is None:
                    dur_el = ET.SubElement(note, _q(ns, "duration"))
                if (dur_el.text or "").strip() != str(target_dur):
                    dur_el.text = str(target_dur)
                    changed = True
            if _sync_chord_followers_with_leader(notes, ns, idx, strip_tuplet=False):
                changed = True
        return changed

    if kind == "applyBeam":
        try:
            from_idx = int(fix.get("fromNoteIndex"))
            to_idx = int(fix.get("toNoteIndex"))
            beam_number = int(fix.get("beamNumber", 1))
        except (TypeError, ValueError):
            return False
        from_idx = _chord_leader_index(notes, ns, from_idx)
        from_idx = _resolve_beam_endpoint(
            notes, ns, from_idx, fix.get("fromPitch"), fix.get("fromStaff")
        )
        to_idx = _resolve_beam_endpoint(
            notes, ns, to_idx, fix.get("toPitch"), fix.get("toStaff")
        )
        if from_idx < 0 or to_idx < from_idx or to_idx >= len(notes):
            return False
        if beam_number < 1 or beam_number > 4:
            return False
        try:
            expected = int(fix.get("beamNoteCount", 0))
        except (TypeError, ValueError):
            expected = 0
        leaders = _beam_leader_indices_in_range(notes, ns, from_idx, to_idx)
        if expected >= 2 and len(leaders) < expected:
            leaders = _extend_beam_leaders(notes, ns, leaders, expected)
        if len(leaders) < 2:
            return False
        lo, hi = leaders[0], leaders[-1]
        divisions, _beats, _bt = _effective_divisions_and_time(part, ns, measure)
        indices = list(range(lo, hi + 1))
        return _apply_beam_to_range(notes, ns, indices, beam_number, divisions)

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

            # whole/half rest display-step C/D/E → 제거 (온쉼·2분쉼 한 줄 위로 붙는 현상)
            for note in list_note_elements(measure, ns):
                rest_el = note.find(_q(ns, "rest"))
                if rest_el is None:
                    continue
                type_el = note.find(_q(ns, "type"))
                note_type = (
                    (type_el.text or "").strip() if type_el is not None and type_el.text else ""
                )
                if note_type not in ("whole", "half"):
                    continue
                step_el = rest_el.find(_q(ns, "display-step"))
                step = (step_el.text or "").strip().upper() if step_el is not None and step_el.text else ""
                if step not in ("C", "D", "E"):
                    continue
                for tag in ("display-step", "display-octave"):
                    el = rest_el.find(_q(ns, tag))
                    if el is not None:
                        rest_el.remove(el)
                stats["restDisplayCleared"] += 1
                measure_changed = True

            # 4·8·16분 등 짧은 쉼 display-step(B4 등) → 제거
            for note in list_note_elements(measure, ns):
                rest_el = note.find(_q(ns, "rest"))
                if rest_el is None:
                    continue
                type_el = note.find(_q(ns, "type"))
                note_type = (
                    (type_el.text or "").strip() if type_el is not None and type_el.text else ""
                )
                if note_type not in ("quarter", "eighth", "16th", "32nd", "64th", "128th"):
                    continue
                step_el = rest_el.find(_q(ns, "display-step"))
                if step_el is None or not step_el.text:
                    continue
                for tag in ("display-step", "display-octave"):
                    el = rest_el.find(_q(ns, tag))
                    if el is not None:
                        rest_el.remove(el)
                stats["restDisplayCleared"] += 1
                measure_changed = True

            # 마디 전체 쉼표(한 voice) display-step/octave 힌트 제거
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


_SAME_X_TOLERANCE = 2.0
_PARALLEL_STEM_X_TOLERANCE = 72.0


def _note_stem_direction(note: ET.Element, ns: str) -> str:
    stem_el = note.find(_q(ns, "stem"))
    if stem_el is not None and stem_el.text:
        return stem_el.text.strip().lower()
    return ""


def _parallel_cluster_x_tolerance(grps: list[list[ET.Element]], ns: str) -> float:
    stems = {_note_stem_direction(g[0], ns) for g in grps if g}
    stems.discard("")
    if len(stems) > 1:
        return _PARALLEL_STEM_X_TOLERANCE
    return _SAME_X_TOLERANCE


def _staff_timed_leader_starts(
    measure: ET.Element, ns: str, staff: str
) -> list[tuple[int, int]]:
    """(note `<note>` index, voice timeline start divisions) for chord leaders on staff."""
    notes = list_note_elements(measure, ns)
    voice_cursor: dict[str, int] = {}
    last_note_voice = "1"
    out: list[tuple[int, int]] = []
    for i, el in enumerate(measure):
        loc = _local(el)
        if loc == "backup":
            v = _timeline_voice(el, last_note_voice)
            dur_el = el.find(_q(ns, "duration"))
            dur = int(dur_el.text.strip()) if dur_el is not None and dur_el.text and dur_el.text.strip().isdigit() else 0
            voice_cursor[v] = max(0, voice_cursor.get(v, 0) - dur)
        elif loc == "forward":
            v = _timeline_voice(el, last_note_voice)
            dur_el = el.find(_q(ns, "duration"))
            dur = int(dur_el.text.strip()) if dur_el is not None and dur_el.text and dur_el.text.strip().isdigit() else 0
            voice_cursor[v] = voice_cursor.get(v, 0) + dur
        elif loc == "note":
            if el.find(_q(ns, "chord")) is not None:
                continue
            voice, st = _note_voice_staff(el, ns)
            if st != staff or _is_grace_or_cue(el, ns):
                continue
            last_note_voice = voice
            try:
                ni = notes.index(el)
            except ValueError:
                continue
            start = voice_cursor.get(voice, 0)
            out.append((ni, start))
            voice_cursor[voice] = start + _note_duration(el, ns)
    return out


def _timeline_voice(el: ET.Element, fallback: str) -> str:
    for child in el:
        if _local(child) == "voice" and child.text and child.text.strip():
            return child.text.strip()
    return fallback


def _apply_parallel_groups_to_staff(
    measure: ET.Element,
    ns: str,
    staff: str,
    groups: list[list[ET.Element]],
    notes: list[ET.Element],
    *,
    keeper_by_doc_index: bool = False,
) -> bool:
    if len(groups) < 2:
        return False
    xs = [_parse_default_x(g[0]) for g in groups]
    finite_xs = [x for x in xs if x is not None]
    x_val = min(finite_xs) if finite_xs else 32.0
    durs = [_note_duration(g[0], ns) for g in groups]
    changed = False
    if keeper_by_doc_index:
        keeper_i = _pick_parallel_keeper_by_doc_index(groups, notes)
    else:
        keeper_i = _pick_parallel_keeper_index(groups, notes, ns, staff, x_val)
    if len(set(durs)) == 1:
        for i, grp in enumerate(groups):
            if i == keeper_i:
                for note in grp:
                    if note.get("default-x") != f"{x_val:.2f}":
                        note.set("default-x", f"{x_val:.2f}")
                        changed = True
                continue
            for note in grp:
                if _ensure_chord_tag(note, ns):
                    changed = True
                if note.get("default-x") != f"{x_val:.2f}":
                    note.set("default-x", f"{x_val:.2f}")
                    changed = True
        return changed
    primary_voice = _note_voice_staff(groups[keeper_i][0], ns)[0]
    used_voices = {_note_voice_staff(g[0], ns)[0] for g in groups}
    secondary_voices: dict[int, str] = {}
    for i, grp in enumerate(groups):
        for note in grp:
            if note.get("default-x") != f"{x_val:.2f}":
                note.set("default-x", f"{x_val:.2f}")
                changed = True
        if i == keeper_i:
            continue
        new_voice = _allocate_staff_voice(staff, used_voices)
        used_voices.add(new_voice)
        secondary_voices[i] = new_voice
        for note in grp:
            cur_v, _ = _note_voice_staff(note, ns)
            if cur_v != new_voice:
                _set_note_voice_staff(note, ns, new_voice, staff)
                changed = True
    if changed:
        voice_forward: dict[str, int] = {}
        if secondary_voices:
            staff_notes = [
                n
                for n in list_note_elements(measure, ns)
                if _note_voice_staff(n, ns)[1] == staff and not _is_grace_or_cue(n, ns)
            ]
            keeper_leader = groups[keeper_i][0]
            if keeper_leader.find(_q(ns, "chord")) is not None:
                onset_leader = notes[_chord_leader_index(notes, ns, notes.index(keeper_leader))]
            else:
                onset_leader = keeper_leader
            onset = _note_onset_in_voice_layer(staff_notes, ns, primary_voice, onset_leader)
            for new_voice in secondary_voices.values():
                voice_forward[new_voice] = onset
        _rebuild_staff_voice_block(measure, ns, staff, primary_voice, voice_forward)
    return changed


def _leftmost_selected_note_index(
    notes: list[ET.Element], ns: str, selected: list[int]
) -> int:
    def key(i: int) -> tuple[float, int]:
        x = _parse_default_x(notes[i])
        return (x if x is not None else 1_000_000.0, i)

    return min(selected, key=key)


def _parallel_anchor_index(
    notes: list[ET.Element], ns: str, selected: list[int], beam_locked: set[int]
) -> int:
    """기준 음: 미선택과 빔으로 이어진 선택음이 있으면 그중 가장 왼쪽 x, 아니면 전체 min x."""
    if beam_locked:
        return min(
            beam_locked,
            key=lambda i: (
                _parse_default_x(notes[_chord_leader_index(notes, ns, i)]) or 1_000_000.0,
                _chord_leader_index(notes, ns, i),
            ),
        )
    return _leftmost_selected_note_index(notes, ns, selected)


def _selected_chord_leader_indices(
    notes: list[ET.Element], ns: str, selected: set[int]
) -> list[int]:
    leaders: list[int] = []
    seen: set[int] = set()
    for i in sorted(selected):
        li = _chord_leader_index(notes, ns, i)
        if li not in seen:
            seen.add(li)
            leaders.append(li)
    return leaders


def _set_note_chord_group_voice(
    notes: list[ET.Element], ns: str, leader_i: int, voice: str, staff: str
) -> None:
    _set_note_voice_staff(notes[leader_i], ns, voice, staff)
    for fi in _chord_follower_indices(notes, ns, leader_i):
        _set_note_voice_staff(notes[fi], ns, voice, staff)


def _parallel_onset_time_for_note_index(
    measure: ET.Element, ns: str, staff: str, notes: list[ET.Element], index: int
) -> int:
    starts = dict(_staff_timed_leader_starts(measure, ns, staff))
    note = notes[index]
    if note.find(_q(ns, "chord")) is not None:
        leader_i = _chord_leader_index(notes, ns, index)
        return starts.get(leader_i, 0)
    return starts.get(index, 0)


def _set_or_insert_forward_before_note(
    measure: ET.Element, ns: str, note: ET.Element, voice: str, duration: int
) -> bool:
    if duration <= 0:
        return False
    children = list(measure)
    try:
        pos = children.index(note)
    except ValueError:
        return False
    if pos > 0 and _local(children[pos - 1]) == "forward":
        fwd = children[pos - 1]
        dur_el = fwd.find(_q(ns, "duration"))
        if dur_el is None:
            dur_el = ET.SubElement(fwd, _q(ns, "duration"))
        dur_el.text = str(duration)
        voice_el = fwd.find(_q(ns, "voice"))
        if voice_el is None:
            voice_el = ET.SubElement(fwd, _q(ns, "voice"))
        voice_el.text = voice
        return True
    fwd = ET.Element(_q(ns, "forward"))
    ET.SubElement(fwd, _q(ns, "duration")).text = str(duration)
    ET.SubElement(fwd, _q(ns, "voice")).text = voice
    measure.insert(pos, fwd)
    return True


def _beam_span_note_indices(
    notes: list[ET.Element], ns: str, index: int, staff: str
) -> set[int]:
    """`<beam>`으로 연결된 인접 음표 index(같은 staff, 화음 포함)."""
    leader_i = _chord_leader_index(notes, ns, index)
    leader = notes[leader_i]
    if _note_voice_staff(leader, ns)[1] != staff:
        return {index}
    span: set[int] = {leader_i}
    for follower in _chord_follower_indices(notes, ns, leader_i):
        span.add(follower)
    if _note_beams(leader, ns):
        for note in _collect_beam_followers(notes, ns, leader, staff=staff):
            try:
                span.add(notes.index(note))
            except ValueError:
                pass
        j = leader_i - 1
        while j >= 0:
            note = notes[j]
            if _note_voice_staff(note, ns)[1] != staff:
                break
            if note.find(_q(ns, "chord")) is not None:
                li = _chord_leader_index(notes, ns, j)
                if li in span:
                    span.add(j)
                    j -= 1
                    continue
                break
            beams = _note_beams(note, ns)
            if not beams:
                break
            span.add(j)
            for fi in _chord_follower_indices(notes, ns, j):
                span.add(fi)
            if "begin" in beams:
                break
            j -= 1
    return span


def _selected_beam_locked_indices(
    notes: list[ET.Element], ns: str, staff: str, selected: set[int]
) -> set[int]:
    """선택 음표 중 미선택 음과 `<beam>`으로 이어진 것 — voice 변경 금지."""
    locked: set[int] = set()
    for i in selected:
        leader_i = _chord_leader_index(notes, ns, i)
        if not _note_beams(notes[leader_i], ns):
            continue
        span = _beam_span_note_indices(notes, ns, i, staff)
        if any(j not in selected for j in span):
            locked.update(j for j in span if j in selected)
    return locked


def _remove_chord_tag(note: ET.Element, ns: str) -> bool:
    chord_el = note.find(_q(ns, "chord"))
    if chord_el is None:
        return False
    note.remove(chord_el)
    return True


def _detach_unselected_chord_followers(
    notes: list[ET.Element], ns: str, leader_i: int, selected: set[int]
) -> bool:
    """선택 리더에서 미선택 화음 멤버를 분리 — `<chord/>` 제거."""
    changed = False
    for fi in _chord_follower_indices(notes, ns, leader_i):
        if fi not in selected and _remove_chord_tag(notes[fi], ns):
            changed = True
    return changed


def _insert_backup_before_note(
    measure: ET.Element, ns: str, note: ET.Element, voice: str, duration: int
) -> bool:
    if duration <= 0:
        return False
    children = list(measure)
    try:
        pos = children.index(note)
    except ValueError:
        return False
    if pos > 0 and _local(children[pos - 1]) == "backup":
        backup = children[pos - 1]
        dur_el = backup.find(_q(ns, "duration"))
        if dur_el is None:
            dur_el = ET.SubElement(backup, _q(ns, "duration"))
        dur_el.text = str(duration)
        voice_el = backup.find(_q(ns, "voice"))
        if voice_el is None:
            voice_el = ET.SubElement(backup, _q(ns, "voice"))
        voice_el.text = voice
        return True
    backup = ET.Element(_q(ns, "backup"))
    ET.SubElement(backup, _q(ns, "duration")).text = str(duration)
    ET.SubElement(backup, _q(ns, "voice")).text = voice
    measure.insert(pos, backup)
    return True


def _link_parallel_onsets_by_indices(
    measure: ET.Element, ns: str, staff: str, indices: list[int]
) -> bool:
    """선택 #index만 — 기준음(빔 anchor 또는 min x)의 default-x·연주 시점으로 맞춤."""
    notes = list_note_elements(measure, ns)
    if len(indices) < 2:
        return False
    selected: list[int] = []
    for idx in indices:
        try:
            i = int(idx)
        except (TypeError, ValueError):
            return False
        if i < 0 or i >= len(notes):
            return False
        _voice, st = _note_voice_staff(notes[i], ns)
        if st != staff or _is_grace_or_cue(notes[i], ns):
            return False
        if i not in selected:
            selected.append(i)
    if len(selected) < 2:
        return False

    selected_set = set(selected)
    beam_locked = _selected_beam_locked_indices(notes, ns, staff, selected_set)
    anchor_i = _parallel_anchor_index(notes, ns, selected, beam_locked)
    anchor_leader = _chord_leader_index(notes, ns, anchor_i)
    anchor_x = _parse_default_x(notes[anchor_leader])
    x_str = f"{(anchor_x if anchor_x is not None else 32.0):.2f}"
    anchor_t = _parallel_onset_time_for_note_index(measure, ns, staff, notes, anchor_leader)
    changed = False

    for i in selected:
        if notes[i].get("default-x") != x_str:
            notes[i].set("default-x", x_str)
            changed = True

    by_dur: dict[int, list[int]] = {}
    for i in selected:
        by_dur.setdefault(_note_duration(notes[i], ns), []).append(i)
    for _dur, idxs in by_dur.items():
        if len(idxs) < 2:
            continue
        leader = min(idxs, key=lambda i: (_parse_default_x(notes[i]) or 1_000_000.0, i))
        for i in idxs:
            if i == leader:
                continue
            if _ensure_chord_tag(notes[i], ns):
                changed = True

    for i in sorted(beam_locked):
        leader_i = _chord_leader_index(notes, ns, i)
        if leader_i == anchor_leader:
            continue
        note = notes[leader_i]
        cur_t = _parallel_onset_time_for_note_index(measure, ns, staff, notes, leader_i)
        if cur_t > anchor_t:
            voice = _note_voice_staff(note, ns)[0]
            if _insert_backup_before_note(measure, ns, note, voice, cur_t - anchor_t):
                changed = True

    used_voices = {_note_voice_staff(notes[i], ns)[0] for i in selected}
    for leader_i in _selected_chord_leader_indices(notes, ns, selected_set):
        if leader_i in beam_locked or leader_i == anchor_leader:
            continue
        if _detach_unselected_chord_followers(notes, ns, leader_i, selected_set):
            changed = True
        note = notes[leader_i]
        cur_t = _parallel_onset_time_for_note_index(measure, ns, staff, notes, leader_i)
        if cur_t == anchor_t:
            continue
        new_voice = _allocate_staff_voice(staff, used_voices)
        used_voices.add(new_voice)
        if _note_voice_staff(note, ns)[0] != new_voice:
            _set_note_chord_group_voice(notes, ns, leader_i, new_voice, staff)
            changed = True
        if _set_or_insert_forward_before_note(measure, ns, note, new_voice, anchor_t):
            changed = True
    return changed


def _is_grace_or_cue(note: ET.Element, ns: str) -> bool:
    return note.find(_q(ns, "grace")) is not None or note.get("cue") == "yes"


def _chord_groups_in_order(notes: list[ET.Element], ns: str) -> list[list[ET.Element]]:
    groups: list[list[ET.Element]] = []
    current: list[ET.Element] = []
    for note in notes:
        if note.find(_q(ns, "chord")) is not None and current:
            current.append(note)
        else:
            if current:
                groups.append(current)
            current = [note]
    if current:
        groups.append(current)
    return groups


def _sort_notes_by_default_x(notes: list[ET.Element], ns: str) -> list[ET.Element]:
    groups = _chord_groups_in_order(notes, ns)
    groups.sort(
        key=lambda grp: (
            _parse_default_x(grp[0]) if _parse_default_x(grp[0]) is not None else 1_000_000.0,
            list(notes).index(grp[0]) if grp[0] in notes else 0,
        )
    )
    out: list[ET.Element] = []
    for grp in groups:
        out.extend(grp)
    return out


def _voice_layer_duration(notes: list[ET.Element], ns: str) -> int:
    total = 0
    for grp in _chord_groups_in_order(notes, ns):
        if _is_grace_or_cue(grp[0], ns):
            continue
        total += _note_duration(grp[0], ns)
    return total


def _measure_has_multivoice_layers(measure: ET.Element, ns: str) -> bool:
    if any(_local(el) == "backup" for el in measure):
        return True
    voices_by_staff: dict[str, set[str]] = {}
    for note in list_note_elements(measure, ns):
        voice, staff = _note_voice_staff(note, ns)
        voices_by_staff.setdefault(staff, set()).add(voice)
    return any(len(vs) > 1 for vs in voices_by_staff.values())


def _ensure_chord_tag(note: ET.Element, ns: str) -> bool:
    if note.find(_q(ns, "chord")) is not None or _is_grace_or_cue(note, ns):
        return False
    note.insert(0, ET.Element(_q(ns, "chord")))
    _sort_note_children(note, ns)
    return True


def _allocate_staff_voice(staff: str, used: set[str]) -> str:
    if staff == "2":
        candidates = ["5", "6", "7", "8", "9"]
    else:
        candidates = ["1", "2", "3", "4"]
    for c in candidates:
        if c not in used:
            return c
    n = 1
    while str(n) in used:
        n += 1
    return str(n)


def _staff_parallel_onset_needs_repair(measure: ET.Element, ns: str, staff: str) -> bool:
    notes = [
        n
        for n in list_note_elements(measure, ns)
        if _note_voice_staff(n, ns)[1] == staff and not _is_grace_or_cue(n, ns)
    ]
    if len(notes) < 2:
        return False
    voices = {_note_voice_staff(n, ns)[0] for n in notes}
    if len(voices) > 1:
        return False
    leaders = _chord_groups_in_order(notes, ns)
    clusters: list[list[list[ET.Element]]] = []
    for grp in leaders:
        x = _parse_default_x(grp[0])
        x_val = x if x is not None else 1_000_000.0
        if clusters:
            merged = clusters[-1][1] + [grp]
            tol = _parallel_cluster_x_tolerance(merged, ns)
            if abs(x_val - clusters[-1][0]) <= tol:
                clusters[-1][1].append(grp)
                continue
        clusters.append((x_val, [grp]))
    for _x, grps in clusters:
        if len(grps) > 1:
            return True
    return False


def _collect_beam_followers(
    notes: list[ET.Element],
    ns: str,
    leader: ET.Element,
    *,
    staff: str | None = None,
    stop_at_indices: set[int] | None = None,
) -> list[ET.Element]:
    """리더 음표와 `<beam>`으로 이어진 후속 음표(화음 멤버 포함)를 수집 — 같은 staff만."""
    try:
        start = notes.index(leader)
    except ValueError:
        return [leader]
    span = [leader]
    beams = _note_beams(leader, ns)
    if not beams or not any(b in ("begin", "continue", "end") for b in beams):
        return span
    leader_staff = _note_voice_staff(leader, ns)[1]
    staff = staff or leader_staff
    j = start + 1
    while j < len(notes):
        if stop_at_indices and j in stop_at_indices:
            break
        note = notes[j]
        if _note_voice_staff(note, ns)[1] != staff:
            break
        if note.find(_q(ns, "chord")) is not None:
            span.append(note)
            j += 1
            continue
        nb = _note_beams(note, ns)
        if not nb:
            break
        span.append(note)
        if "end" in nb:
            break
        j += 1
    return span


def _pitch_seen_earlier_on_staff(
    notes: list[ET.Element], ns: str, note: ET.Element, staff: str, x_val: float
) -> bool:
    pitch = _note_pitch_str(note, ns)
    if not pitch:
        return False
    for other in notes:
        if other is note or _note_voice_staff(other, ns)[1] != staff:
            continue
        if other.find(_q(ns, "chord")) is not None:
            continue
        ox = _parse_default_x(other)
        if ox is None or ox >= x_val - 0.5:
            continue
        if _note_pitch_str(other, ns) == pitch:
            return True
    return False


def _pick_parallel_keeper_index(
    grps: list[list[ET.Element]], notes: list[ET.Element], ns: str, staff: str, x_val: float
) -> int:
    def score(i: int) -> tuple[int, int]:
        lead = grps[i][0]
        dup = 1 if _pitch_seen_earlier_on_staff(notes, ns, lead, staff, x_val) else 0
        return (1 - dup, _note_duration(lead, ns))

    return max(range(len(grps)), key=score)


def _pick_parallel_keeper_by_doc_index(
    grps: list[list[ET.Element]], notes: list[ET.Element]
) -> int:
    def min_doc_index(i: int) -> int:
        return min(notes.index(note) for note in grps[i])

    return min(range(len(grps)), key=min_doc_index)


def _parallel_link_group_notes(
    notes: list[ET.Element],
    ns: str,
    index: int,
    selected_indices: set[int],
) -> list[ET.Element]:
    """사용자가 고른 #index 기준 — 같은 staff·화음·빔만 확장(다른 선택·PL staff 제외)."""
    note = notes[index]
    staff = _note_voice_staff(note, ns)[1]
    indices: set[int] = {index}
    if note.find(_q(ns, "chord")) is None:
        for follower_idx in _chord_follower_indices(notes, ns, index):
            if follower_idx not in selected_indices:
                indices.add(follower_idx)
        beam_leader = note
    else:
        beam_leader = note
    other_selected = selected_indices - {index}
    for follower in _collect_beam_followers(
        notes,
        ns,
        beam_leader,
        staff=staff,
        stop_at_indices=other_selected,
    ):
        try:
            follower_idx = notes.index(follower)
        except ValueError:
            continue
        if follower_idx in other_selected:
            continue
        indices.add(follower_idx)
    return [notes[i] for i in sorted(indices)]


def _note_onset_in_voice_layer(
    notes: list[ET.Element], ns: str, voice: str, leader: ET.Element
) -> int:
    cursor = 0
    for note in notes:
        note_voice, _ = _note_voice_staff(note, ns)
        if note_voice != voice:
            continue
        if note.find(_q(ns, "chord")) is not None:
            continue
        if note is leader:
            return cursor
        cursor += _note_duration(note, ns)
    return 0


def _repair_parallel_onsets_on_staff(measure: ET.Element, ns: str, staff: str) -> bool:
    """같은 staff·voice·default-x에서 박자만 다른 음 → 보조 voice, 같으면 `<chord/>`."""
    notes = [
        n
        for n in list_note_elements(measure, ns)
        if _note_voice_staff(n, ns)[1] == staff and not _is_grace_or_cue(n, ns)
    ]
    if len(notes) < 2:
        return False
    voices = {_note_voice_staff(n, ns)[0] for n in notes}
    if len(voices) != 1:
        return False
    leaders = _chord_groups_in_order(notes, ns)
    clusters: list[tuple[float, list[list[ET.Element]]]] = []
    for grp in leaders:
        x = _parse_default_x(grp[0])
        x_val = x if x is not None else 1_000_000.0
        if clusters:
            merged = clusters[-1][1] + [grp]
            tol = _parallel_cluster_x_tolerance(merged, ns)
            if abs(x_val - clusters[-1][0]) <= tol:
                clusters[-1][1].append(grp)
                continue
        clusters.append((x_val, [grp]))
    changed = False
    for _x_val, grps in clusters:
        if len(grps) < 2:
            continue
        if _apply_parallel_groups_to_staff(measure, ns, staff, grps, notes):
            changed = True
    return changed


def _find_staff_block_span(measure: ET.Element, ns: str, staff: str) -> tuple[int | None, int | None]:
    children = list(measure)
    start: int | None = None
    end: int | None = None
    for i, el in enumerate(children):
        loc = _local(el)
        if loc == "note" and _note_voice_staff(el, ns)[1] == staff:
            if start is None:
                start = i
            end = i
        elif start is not None and loc in ("backup", "forward"):
            if end is not None and i <= end + 3:
                end = i
        elif start is not None and loc == "note" and _note_voice_staff(el, ns)[1] != staff:
            break
    return start, end


def _rebuild_staff_voice_block(
    measure: ET.Element,
    ns: str,
    staff: str,
    primary_voice: str | None = None,
    voice_forward: dict[str, int] | None = None,
) -> None:
    """한 staff의 note·backup·forward 블록을 voice별 문서 순서로 재구성."""
    start, end = _find_staff_block_span(measure, ns, staff)
    if start is None or end is None:
        return
    children = list(measure)
    block = children[start : end + 1]
    block_note_order = [
        el
        for el in block
        if _local(el) == "note" and _note_voice_staff(el, ns)[1] == staff
    ]
    doc_pos = {id(note): idx for idx, note in enumerate(block_note_order)}
    notes_by_voice: dict[str, list[ET.Element]] = {}
    for el in block:
        if _local(el) != "note":
            continue
        voice, st = _note_voice_staff(el, ns)
        if st != staff:
            continue
        notes_by_voice.setdefault(voice, []).append(el)

    if not notes_by_voice:
        return

    def voice_sort_key(v: str) -> tuple[int, int, int]:
        min_pos = min(doc_pos.get(id(note), 1_000_000) for note in notes_by_voice[v])
        pri = 0 if primary_voice is not None and v == primary_voice else 1
        try:
            vn = int(v)
        except ValueError:
            vn = 999
        return (pri, min_pos, vn)

    voice_order = sorted(notes_by_voice.keys(), key=voice_sort_key)
    rebuilt: list[ET.Element] = []
    for i, voice in enumerate(voice_order):
        ordered = sorted(
            notes_by_voice[voice], key=lambda note: doc_pos.get(id(note), 1_000_000)
        )
        rebuilt.extend(ordered)
        if i + 1 < len(voice_order):
            backup_el = ET.Element(_q(ns, "backup"))
            ET.SubElement(backup_el, _q(ns, "duration")).text = str(
                _voice_layer_duration(notes_by_voice[voice], ns)
            )
            rebuilt.append(backup_el)
            next_voice = voice_order[i + 1]
            fwd = (voice_forward or {}).get(next_voice, 0)
            if fwd > 0:
                fwd_el = ET.Element(_q(ns, "forward"))
                ET.SubElement(fwd_el, _q(ns, "duration")).text = str(fwd)
                ET.SubElement(fwd_el, _q(ns, "voice")).text = next_voice
                rebuilt.append(fwd_el)

    for el in block:
        measure.remove(el)
    insert_at = start
    for el in rebuilt:
        measure.insert(insert_at, el)
        insert_at += 1


def _rebuild_measure_preserve_voices(measure: ET.Element, ns: str) -> None:
    """backup·다중 voice가 있는 마디 — voice별로만 default-x 정렬, 구조 유지."""
    start_elements: list[ET.Element] = []
    end_elements: list[ET.Element] = []
    note_attachments: dict[ET.Element, list[ET.Element]] = {}
    note_preamble: dict[ET.Element, list[ET.Element]] = {}
    staff_preamble: dict[int, list[ET.Element]] = {}
    blocks: list[tuple[str, Any]] = []
    current_voice: tuple[str, str] | None = None
    current_notes: list[ET.Element] = []
    last_seen_note: ET.Element | None = None

    for el in measure:
        tag = _local(el)
        if tag == "note":
            voice_staff = _note_voice_staff(el, ns)
            if current_notes and voice_staff != current_voice:
                blocks.append(("notes", current_voice, current_notes))
                current_notes = []
            current_voice = voice_staff
            current_notes.append(el)
            last_seen_note = el
        elif tag in ("backup", "forward"):
            if current_notes:
                blocks.append(("notes", current_voice, current_notes))
                current_notes = []
                current_voice = None
            blocks.append((tag, el))
            last_seen_note = None
        elif tag in ("print", "attributes"):
            if current_notes:
                blocks.append(("notes", current_voice, current_notes))
                current_notes = []
                current_voice = None
            start_elements.append(el)
        elif tag == "barline":
            if current_notes:
                blocks.append(("notes", current_voice, current_notes))
                current_notes = []
                current_voice = None
            end_elements.append(el)
        else:
            if _local(el) == "direction" and _try_preamble_direction_before_following_note(
                measure, el, note_preamble
            ):
                continue
            _assign_timeline_attachment(
                measure, el, ns, last_seen_note, note_attachments, staff_preamble, start_elements
            )
    if current_notes:
        blocks.append(("notes", current_voice, current_notes))

    new_blocks: list[tuple[str, Any]] = []
    for block in blocks:
        if block[0] == "notes":
            _, _voice_staff, notes = block
            new_blocks.append(("notes", _sort_notes_by_default_x(notes, ns)))
        else:
            new_blocks.append(block)

    staff_preamble_emitted: set[int] = set()
    for el in list(measure):
        measure.remove(el)
    for el in start_elements:
        measure.append(el)
    for block in new_blocks:
        if block[0] == "notes":
            notes = block[1]
            if notes:
                _, st = _note_voice_staff(notes[0], ns)
                try:
                    st_n = int(st)
                except ValueError:
                    st_n = 1
                if st_n not in staff_preamble_emitted:
                    for pre in staff_preamble.get(st_n, []):
                        measure.append(pre)
                    staff_preamble_emitted.add(st_n)
            for note in notes:
                for pre in note_preamble.get(note, []):
                    measure.append(pre)
                measure.append(note)
                for att in note_attachments.get(note, []):
                    measure.append(att)
        else:
            measure.append(block[1])
    for el in end_elements:
        measure.append(el)


def _rebuild_measure_flat_staffs(measure: ET.Element, ns: str) -> None:
    """단일 voice/staff — staff1 → backup → staff2 (기존 HITL 삽입 정렬)."""
    notes_staff1: list[ET.Element] = []
    notes_staff2: list[ET.Element] = []
    start_elements: list[ET.Element] = []
    end_elements: list[ET.Element] = []
    note_attachments: dict[ET.Element, list[ET.Element]] = {}
    note_preamble: dict[ET.Element, list[ET.Element]] = {}
    staff_preamble: dict[int, list[ET.Element]] = {}
    last_seen_note: ET.Element | None = None

    for el in measure:
        tag = _local(el)
        if tag == "note":
            last_seen_note = el
        elif tag in ("backup", "forward"):
            last_seen_note = None
        elif tag in ("print", "attributes"):
            start_elements.append(el)
        elif tag == "barline":
            end_elements.append(el)
        else:
            if _local(el) == "direction" and _try_preamble_direction_before_following_note(
                measure, el, note_preamble
            ):
                continue
            _assign_timeline_attachment(
                measure, el, ns, last_seen_note, note_attachments, staff_preamble, start_elements
            )

    for note in list_note_elements(measure, ns):
        _, staff = _note_voice_staff(note, ns)
        if staff == "2":
            notes_staff2.append(note)
        else:
            notes_staff1.append(note)

    sorted_notes_staff1 = _sort_notes_by_default_x(notes_staff1, ns)
    sorted_notes_staff2 = _sort_notes_by_default_x(notes_staff2, ns)
    dur_staff1 = _voice_layer_duration(sorted_notes_staff1, ns)

    for el in list(measure):
        measure.remove(el)
    for el in start_elements:
        measure.append(el)
    for pre in staff_preamble.get(1, []):
        measure.append(pre)
    for note in sorted_notes_staff1:
        for pre in note_preamble.get(note, []):
            measure.append(pre)
        measure.append(note)
        for att in note_attachments.get(note, []):
            measure.append(att)
    if sorted_notes_staff2:
        backup_el = ET.Element(_q(ns, "backup"))
        ET.SubElement(backup_el, _q(ns, "duration")).text = str(dur_staff1)
        measure.append(backup_el)
        for pre in staff_preamble.get(2, []):
            measure.append(pre)
        for note in sorted_notes_staff2:
            for pre in note_preamble.get(note, []):
                measure.append(pre)
            measure.append(note)
            for att in note_attachments.get(note, []):
                measure.append(att)
    for el in end_elements:
        measure.append(el)


def _calculate_staff1_duration_robust(measure: ET.Element, ns: str) -> int:
    time_cursors = {}
    max_staff1_time = 0
    for el in measure:
        tag = _local(el)
        if tag == "note":
            voice, staff = _note_voice_staff(el, ns)
            is_chord = el.find(_q(ns, "chord")) is not None
            is_grace = _is_grace_or_cue(el, ns)
            dur = _note_duration(el, ns) or 0
            current_time = time_cursors.get((voice, staff), 0)
            if not is_chord and not is_grace:
                new_time = current_time + dur
                time_cursors[(voice, staff)] = new_time
                if staff == "1":
                    max_staff1_time = max(max_staff1_time, new_time)
        elif tag == "backup":
            dur = 0
            dur_el = el.find(_q(ns, "duration"))
            if dur_el is not None and dur_el.text and dur_el.text.strip().isdigit():
                dur = int(dur_el.text.strip())
            for key in time_cursors:
                time_cursors[key] = max(0, time_cursors[key] - dur)
        elif tag == "forward":
            dur = 0
            dur_el = el.find(_q(ns, "duration"))
            if dur_el is not None and dur_el.text and dur_el.text.strip().isdigit():
                dur = int(dur_el.text.strip())
            voice = "1"
            staff = "1"
            v_el = el.find(_q(ns, "voice"))
            s_el = el.find(_q(ns, "staff"))
            if v_el is not None and v_el.text:
                voice = v_el.text.strip()
            if s_el is not None and s_el.text:
                staff = s_el.text.strip()
            time_cursors[(voice, staff)] = time_cursors.get((voice, staff), 0) + dur
            if staff == "1":
                max_staff1_time = max(max_staff1_time, time_cursors[(voice, staff)])
    return max_staff1_time


def _repair_same_staff_backup_before_forward(measure: ET.Element, ns: str) -> int:
    """HITL로 앞 voice 길이가 바뀐 뒤 `<backup>` duration이 stale일 때 보조 voice `<forward>` 앞 backup을 맞춤."""
    children = list(measure)
    repaired = 0
    for i, el in enumerate(children):
        if _local(el) != "backup":
            continue
        j = i + 1
        while j < len(children) and _local(children[j]) not in ("note", "forward"):
            j += 1
        if j >= len(children) or _local(children[j]) != "forward":
            continue
        fwd = children[j]
        if fwd.find(_q(ns, "voice")) is None:
            continue
        seg_notes: list[ET.Element] = []
        staff: str | None = None
        voice: str | None = None
        for k in range(i - 1, -1, -1):
            if _local(children[k]) == "note":
                v, st = _note_voice_staff(children[k], ns)
                if staff is None:
                    staff, voice = st, v
                if st != staff or v != voice:
                    break
                seg_notes.insert(0, children[k])
            elif _local(children[k]) in ("backup", "forward"):
                break
        if not seg_notes:
            continue
        layer_dur = _voice_layer_duration(seg_notes, ns)
        if layer_dur <= 0:
            continue
        dur_el = el.find(_q(ns, "duration"))
        if dur_el is None:
            continue
        if dur_el.text != str(layer_dur):
            dur_el.text = str(layer_dur)
            repaired += 1
    return repaired


def _align_staves_timeline(measure: ET.Element, ns: str) -> None:
    notes = list_note_elements(measure, ns)
    staff1_notes = [n for n in notes if _note_voice_staff(n, ns)[1] == "1" and not _is_grace_or_cue(n, ns)]
    staff2_notes = [n for n in notes if _note_voice_staff(n, ns)[1] == "2" and not _is_grace_or_cue(n, ns)]
    if not staff1_notes or not staff2_notes:
        return

    staff1_duration = _calculate_staff1_duration_robust(measure, ns)
    if staff1_duration <= 0:
        return

    children = list(measure)
    last_s1_idx = -1
    first_s2_idx = len(children)
    for i, el in enumerate(children):
        if el in staff1_notes:
            last_s1_idx = max(last_s1_idx, i)
        elif el in staff2_notes:
            first_s2_idx = min(first_s2_idx, i)

    if last_s1_idx == -1 or first_s2_idx == len(children) or last_s1_idx >= first_s2_idx:
        return

    for i in range(last_s1_idx + 1, first_s2_idx):
        el = children[i]
        if _local(el) == "backup":
            dur_el = el.find(_q(ns, "duration"))
            if dur_el is not None:
                dur_el.text = str(staff1_duration)
            break


def _normalize_staff_note_order(measure: ET.Element, ns: str, staff: str) -> bool:
    """Staff note를 default-x 타임라인 순으로 XML 재배열 — voice 블록·편집기·OSMD 순서 일치."""
    children = list(measure)
    span_start: int | None = None
    span_end: int | None = None
    for i, el in enumerate(children):
        if _local(el) != "note" or _note_voice_staff(el, ns)[1] != staff:
            continue
        if _is_grace_or_cue(el, ns):
            continue
        span_start = i if span_start is None else span_start
        span_end = i
    if span_start is None or span_end is None:
        return False

    extract: list[ET.Element] = []
    for i in range(span_start, span_end + 1):
        el = children[i]
        loc = _local(el)
        if loc == "note" and _note_voice_staff(el, ns)[1] == staff:
            extract.append(el)
        elif loc in ("backup", "forward"):
            extract.append(el)

    notes_only = [el for el in extract if _local(el) == "note"]
    if len(notes_only) < 2:
        return False
    notes = list_note_elements(measure, ns)
    groups = _chord_groups_in_order(notes_only, ns)
    indexed = [
        (
            grp,
            _parse_default_x(grp[0]) if _parse_default_x(grp[0]) is not None else 1_000_000.0,
            notes.index(grp[0]),
        )
        for grp in groups
    ]
    indexed.sort(key=lambda t: (t[1], t[2]))
    voices = {_note_voice_staff(g[0], ns)[0] for g, _, _ in indexed}
    if len(voices) > 1:
        return False
    primary = sorted(voices, key=lambda v: int(v) if v.isdigit() else 999)[0]
    sorted_notes: list[ET.Element] = []
    for grp, _, _ in indexed:
        for note in grp:
            _set_note_voice_staff(note, ns, primary, staff)
        sorted_notes.extend(grp)

    current_leaders = [
        n
        for n in notes_only
        if n.find(_q(ns, "chord")) is None and not _is_grace_or_cue(n, ns)
    ]
    new_leader_order = [g[0] for g, _, _ in indexed]
    if [id(n) for n in current_leaders] == [id(n) for n in new_leader_order] and len(voices) <= 1:
        return False

    for el in extract:
        measure.remove(el)
    insert_at = span_start
    for el in sorted_notes:
        measure.insert(insert_at, el)
        insert_at += 1
    return True


def rebuild_measure_timeline_clean(measure: ET.Element, ns: str) -> None:
    """HITL 삽입 후 마디 timeline 정렬. 다중 voice·동시 시작(다른 박자) 보존."""
    notes = list_note_elements(measure, ns)
    _fix_chord_tag_consistency(notes, ns)
    _sync_all_chord_groups(notes, ns)
    for staff in ("1", "2"):
        _merge_staff_voices_if_non_overlapping(measure, ns, staff)
    for staff in ("1", "2"):
        if _staff_parallel_onset_needs_repair(measure, ns, staff):
            _repair_parallel_onsets_on_staff(measure, ns, staff)
    if _measure_has_multivoice_layers(measure, ns):
        _rebuild_measure_preserve_voices(measure, ns)
    else:
        _rebuild_measure_flat_staffs(measure, ns)
    _repair_same_staff_backup_before_forward(measure, ns)
    _align_staves_timeline(measure, ns)
    notes_after = list_note_elements(measure, ns)
    _fix_chord_tag_consistency(notes_after, ns)
    _sync_all_chord_groups(notes_after, ns)
    for staff in ("1", "2"):
        _merge_staff_voices_if_non_overlapping(measure, ns, staff)
    for staff in ("1", "2"):
        _normalize_staff_note_order(measure, ns, staff)
    _compact_default_x_by_staff(measure, ns)
    _repair_tuplet_brackets_in_measure(measure, ns)


def _repair_tuplet_brackets_in_measure(measure: ET.Element, ns: str) -> bool:
    """혼합 세잇단·orphan beam 태그 — bracket 복구·4분/2분 빔 제거."""
    notes = list_note_elements(measure, ns)
    changed = False
    for start, stop in _tuplet_notation_runs(notes, ns):
        indices = _rhythmic_indices_in_range(notes, ns, start, stop)
        if len(indices) < 2:
            continue
        needs_bracket = _tuplet_span_needs_bracket(notes, indices, ns)
        has_rest = _tuplet_group_has_rest(notes, indices, ns)
        connected = _tuplet_group_has_connected_beam(notes, indices, ns)
        show = _tuplet_show_bracket(
            has_rest, connected, needs_bracket=needs_bracket
        )
        if needs_bracket or not connected:
            for idx in range(start, stop + 1):
                note = notes[idx]
                if _strip_beams_from_note(note, ns):
                    changed = True
                for fidx in _chord_follower_indices(notes, ns, idx):
                    if _strip_beams_from_note(notes[fidx], ns):
                        changed = True
        start_note = notes[start]
        notations = start_note.find(_q(ns, "notations"))
        if notations is None:
            continue
        for tup in notations.findall(_q(ns, "tuplet")):
            if (tup.get("type") or "").strip() != "start":
                continue
            want_sb = "yes" if show else "no"
            want_br = "yes" if show else "no"
            if (tup.get("show-bracket") or "") != want_sb:
                tup.set("show-bracket", want_sb)
                changed = True
            if (tup.get("bracket") or "") != want_br:
                tup.set("bracket", want_br)
                changed = True
            if show and not tup.get("placement"):
                tup.set("placement", _infer_tuplet_placement_for_range(notes, indices, ns))
                changed = True
    return changed


def _strip_all_direction_staff_tags(root: ET.Element, ns: str) -> int:
    """`<direction><staff>` 제거 — OSMD가 악보 N번째 줄로 오인(P5 staff2→P2)."""
    n = 0
    for direction in root.iter():
        if _local(direction) != "direction":
            continue
        staff_el = direction.find(_q(ns, "staff"))
        if staff_el is not None:
            direction.remove(staff_el)
            n += 1
    return n


def apply_fixes_to_root(root: ET.Element, fixes: list[dict[str, Any]]) -> dict[str, int]:
    ns = _ns(root)
    stats = {"applied": 0, "skipped": 0}
    deferred_kinds = {
        "applyBeam",
        "removeBeam",
        "addTie",
        "removeTie",
        "addSlur",
        "removeSlur",
        "applyTriplet",
        "removeTriplet",
    }
    skip_rebuild_kinds = {"linkParallelOnsets"}
    measure_structure_kinds = {"insertEmptyMeasureBefore", "insertEmptyMeasureAfter"}
    pending = list(fixes)
    structure_fixes = [f for f in pending if f.get("kind") in measure_structure_kinds]
    other_fixes = [f for f in pending if f.get("kind") not in measure_structure_kinds]
    deferred: list[dict[str, Any]] = []
    rebuild_touched: set[tuple[str, str]] = set()

    for fix in structure_fixes:
        anchor = _parse_measure_number(str(fix.get("measureMxl") or ""))
        position = "before" if fix.get("kind") == "insertEmptyMeasureBefore" else "after"
        if apply_fix(root, ns, fix):
            stats["applied"] += 1
            if anchor is not None:
                for other in other_fixes:
                    _bump_fix_measure_numbers(other, anchor, position)
                for other in structure_fixes:
                    if other is fix:
                        continue
                    _bump_fix_measure_numbers(other, anchor, position)
        else:
            stats["skipped"] += 1

    for fix in other_fixes:
        part_id = str(fix.get("partId") or "").strip()
        measure_mxl = str(fix.get("measureMxl") or "").strip()
        kind = str(fix.get("kind") or "")
        if part_id and measure_mxl:
            if kind not in skip_rebuild_kinds:
                rebuild_touched.add((part_id, measure_mxl))
        if fix.get("kind") in deferred_kinds:
            deferred.append(fix)
            to_m = str(fix.get("toMeasureMxl") or "").strip()
            if to_m and part_id and to_m != measure_mxl:
                rebuild_touched.add((part_id, to_m))
            from_m = str(fix.get("fromMeasureMxl") or "").strip()
            if from_m and part_id and from_m != measure_mxl:
                rebuild_touched.add((part_id, from_m))
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
    for part_id, measure_mxl in rebuild_touched:
        part = find_part(root, ns, part_id)
        if part is None:
            continue
        measure = find_measure(part, ns, measure_mxl)
        if measure is not None:
            _normalize_measure_note_engraving(part, ns, measure)
            notes = list_note_elements(measure, ns)
            _strip_chord_member_beams(notes, ns)
            rebuild_measure_timeline_clean(measure, ns)
            _migrate_directions_to_notes(measure, ns)
    return stats



def cleanup_chord_beams_in_root(root: ET.Element) -> int:
    """전 악보에서 `<chord/>` 멤버의 orphan `<beam>` 제거 — OSMD 미리보기 호환."""
    ns = _ns(root)
    changed = 0
    for part in root.findall(_q(ns, "part")):
        for measure in part.findall(_q(ns, "measure")):
            notes = list_note_elements(measure, ns)
            if _strip_chord_member_beams(notes, ns):
                changed += 1
            for note in notes:
                _sort_note_children(note, ns)
    return changed


def apply_fixes_file(mxl_path: Path, fixes: list[dict[str, Any]]) -> dict[str, Any]:
    files, root_path, root = load_mxl_root(mxl_path)
    stats = apply_fixes_to_root(root, fixes) if fixes else {"applied": 0, "skipped": 0}
    chord_beam_measures = cleanup_chord_beams_in_root(root)
    write_mxl_root(mxl_path, files, root_path, root)
    return {
        "path": str(mxl_path),
        **stats,
        "fixCount": len(fixes),
        "chordBeamMeasuresCleaned": chord_beam_measures,
    }


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
