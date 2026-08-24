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
PLAY_ORDER_ATTR = "data-hitl-play-order"
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
# MusicXML <ornaments> — OMR이 원본에 없는 모르덴트 등을 넣는 경우 HITL에서 삭제·추가
_ORNAMENT_TAGS = frozenset(
    {
        "trill-mark",
        "turn",
        "delayed-turn",
        "inverted-turn",
        "mordent",
        "inverted-mordent",
        "shake",
        "wavy-line",
        "schleifer",
        "tremolo",
        "haydn",
    }
)
_WEDGE_TYPES = frozenset({"crescendo", "diminuendo", "stop"})


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

def _note_slur_placements(note: ET.Element, ns: str) -> tuple[str | None, str | None]:
    """이음줄 start/stop의 placement(above|below). 없으면 None."""
    start_pl: str | None = None
    stop_pl: str | None = None
    notations = note.find(_q(ns, "notations"))
    if notations is None:
        return start_pl, stop_pl
    for slur in notations.findall(_q(ns, "slur")):
        t = (slur.get("type") or "").strip()
        pl = (slur.get("placement") or "").strip().lower()
        if pl not in ("above", "below"):
            pl = ""
        if t == "start" and start_pl is None:
            start_pl = pl or None
        elif t == "stop" and stop_pl is None:
            stop_pl = pl or None
    return start_pl, stop_pl


def _set_slur_pair_placement(
    notes: list[ET.Element],
    ns: str,
    note_idx: int,
    which: str,
    placement: str,
) -> bool:
    """note_idx의 slur start/stop placement를 바꾸고, 같은 number의 짝에도 맞춤."""
    if note_idx < 0 or note_idx >= len(notes):
        return False
    note = notes[note_idx]
    notations = note.find(_q(ns, "notations"))
    if notations is None:
        return False
    targets: list[ET.Element] = []
    for slur in notations.findall(_q(ns, "slur")):
        t = (slur.get("type") or "").strip()
        if which == "both" or which == t:
            targets.append(slur)
    if not targets:
        return False
    changed = False
    for slur in targets:
        num = (slur.get("number") or "1").strip() or "1"
        t = (slur.get("type") or "").strip()
        if slur.get("placement") != placement:
            slur.set("placement", placement)
            changed = True
        # Match pair across measure notes
        want_other = "stop" if t == "start" else "start" if t == "stop" else ""
        if not want_other:
            continue
        for other in notes:
            onot = other.find(_q(ns, "notations"))
            if onot is None:
                continue
            for os in onot.findall(_q(ns, "slur")):
                if (os.get("type") or "").strip() != want_other:
                    continue
                other_num = (os.get("number") or "1").strip() or "1"
                if other_num != num:
                    continue
                if os.get("placement") != placement:
                    os.set("placement", placement)
                    changed = True
    return changed


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


def _read_play_order(note: ET.Element) -> int | None:
    raw = note.get(PLAY_ORDER_ATTR)
    if raw is None or not str(raw).strip().isdigit():
        return None
    n = int(str(raw).strip())
    return n if n > 0 else None


def _note_pitch_label(note: ET.Element, ns: str) -> str | None:
    pitch_el = note.find(_q(ns, "pitch"))
    if pitch_el is None:
        return None
    step = pitch_el.find(_q(ns, "step"))
    oct_el = pitch_el.find(_q(ns, "octave"))
    alter_el = pitch_el.find(_q(ns, "alter"))
    if step is None or oct_el is None or not step.text or not oct_el.text:
        return None
    acc = ""
    if alter_el is not None and alter_el.text:
        try:
            a = int(float(alter_el.text.strip()))
            acc = "b" if a == -1 else "#" if a == 1 else ""
        except ValueError:
            pass
    return f"{step.text.strip()}{acc}{oct_el.text.strip()}"


def _set_play_order_on_leader(notes: list[ET.Element], ns: str, leader_i: int, order: int) -> bool:
    if order < 1:
        changed = False
        for j in range(leader_i, len(notes)):
            if j > leader_i and notes[j].find(_q(ns, "chord")) is None:
                break
            if notes[j].get(PLAY_ORDER_ATTR) is not None:
                del notes[j].attrib[PLAY_ORDER_ATTR]
                changed = True
        return changed
    order_s = str(int(order))
    changed = False
    for j in range(leader_i, len(notes)):
        if j > leader_i and notes[j].find(_q(ns, "chord")) is None:
            break
        if notes[j].get(PLAY_ORDER_ATTR) != order_s:
            notes[j].set(PLAY_ORDER_ATTR, order_s)
            changed = True
    return changed


def _set_play_order_same_pitch_staff_leaders(
    notes: list[ET.Element],
    ns: str,
    leader_i: int,
    order: int,
    measure: ET.Element | None = None,
) -> bool:
    """같은 staff·음높이·**동일 musical onset**의 다른 voice 중복 leader에만 연주순번을 맞춤.

    OMR이 같은 박에 여러 voice로 같은 pitch를 남긴 경우만 전파한다.
    서로 다른 시점의 동일 pitch(예: m17 F4 화음 여러 개)까지 전파하면
    나중에 설정한 순번이 앞 화음을 덮어쓰거나 미리보기 column이 뒤바뀐다.
    """
    target_pitch = _note_pitch_label(notes[leader_i], ns)
    if not target_pitch:
        return _set_play_order_on_leader(notes, ns, leader_i, order)
    _, target_staff = _note_voice_staff(notes[leader_i], ns)
    target_onset: int | None = None
    if measure is not None:
        target_onset = _parallel_onset_time_for_note_index(
            measure, ns, target_staff, notes, leader_i
        )
    changed = False
    for i, note in enumerate(notes):
        if note.find(_q(ns, "chord")) is not None:
            continue
        if _note_pitch_label(note, ns) != target_pitch:
            continue
        if _note_voice_staff(note, ns)[1] != target_staff:
            continue
        if target_onset is not None:
            onset = _parallel_onset_time_for_note_index(measure, ns, target_staff, notes, i)
            if onset != target_onset:
                continue
        elif i != leader_i:
            # measure 없으면 지정 leader(+화음)만 — 전 staff 전파 금지
            continue
        if _set_play_order_on_leader(notes, ns, i, order):
            changed = True
    return changed


def _sanitize_conflicting_play_orders(measure: ET.Element, ns: str) -> bool:
    """같은 staff·같은 명시 연주순번이 서로 다른 musical onset에 있으면 속성 제거.

    같은 순번 = 동시 column. 옛 same-pitch 전 staff 전파로 F4 화음 여러 개가
    모두 같은 po를 갖게 된 MXL은 미리보기·SVG 매칭을 망가뜨리므로 비운다.
    """
    notes = list_note_elements(measure, ns)
    by_staff: dict[str, dict[str, list[tuple[int, int]]]] = {}
    for i, note in enumerate(notes):
        if note.find(_q(ns, "chord")) is not None:
            continue
        po = note.get(PLAY_ORDER_ATTR)
        if not po:
            continue
        _, st = _note_voice_staff(note, ns)
        onset = _parallel_onset_time_for_note_index(measure, ns, st, notes, i)
        by_staff.setdefault(st, {}).setdefault(po, []).append((i, onset))
    changed = False
    for po_map in by_staff.values():
        for entries in po_map.values():
            onsets = {o for _, o in entries}
            if len(onsets) <= 1:
                continue
            for leader_i, _ in entries:
                if _set_play_order_on_leader(notes, ns, leader_i, 0):
                    changed = True
    return changed


def _clear_play_order_on_other_onsets(
    measure: ET.Element,
    ns: str,
    notes: list[ET.Element],
    staff: str,
    keep_leader_i: int,
    order: int,
) -> bool:
    """연주순번 N을 이 onset column에만 남기고, 같은 staff의 다른 onset에서 N 제거."""
    if order < 1:
        return False
    keep_onset = _parallel_onset_time_for_note_index(measure, ns, staff, notes, keep_leader_i)
    order_s = str(int(order))
    changed = False
    for i, note in enumerate(notes):
        if note.find(_q(ns, "chord")) is not None:
            continue
        if _note_voice_staff(note, ns)[1] != staff:
            continue
        if note.get(PLAY_ORDER_ATTR) != order_s:
            continue
        onset = _parallel_onset_time_for_note_index(measure, ns, staff, notes, i)
        if onset == keep_onset:
            continue
        if _set_play_order_on_leader(notes, ns, i, 0):
            changed = True
    return changed


def _default_play_orders_for_staff(measure: ET.Element, ns: str, staff: str) -> dict[int, int]:
    """staff musical onset(타임라인) 기본 연주순번 — 같은 onset = 같은 순번.

    음표·쉼표 leader 모두 포함. 꾸밈음은 본음보다 앞선 별도 순번을 부여.
    """
    notes = list_note_elements(measure, ns)
    leaders: list[tuple[int, int, int]] = []
    for i, note in enumerate(notes):
        if note.find(_q(ns, "chord")) is not None:
            continue
        _, st = _note_voice_staff(note, ns)
        if st != staff:
            continue
        onset = _parallel_onset_time_for_note_index(measure, ns, staff, notes, i)
        is_grace = note.find(_q(ns, "grace")) is not None
        leaders.append((onset, 0 if is_grace else 1, i))
    leaders.sort()
    out: dict[int, int] = {}
    order = 0
    prev_key: tuple[int, int] | None = None
    for onset, is_reg, i in leaders:
        cur_key = (onset, is_reg)
        is_grace = (is_reg == 0)
        if prev_key is None or cur_key != prev_key or is_grace:
            order += 1
            prev_key = cur_key
        out[i] = order
    return out


def _staff_needs_rest_play_order_rebuild(measure: ET.Element, ns: str, staff: str) -> bool:
    """명시 연주순번이 음표에만 있고 쉼표 leader에는 없으면 재배열 대상."""
    notes = list_note_elements(measure, ns)
    has_rest_without_po = False
    has_pitched_with_po = False
    for note in notes:
        if note.find(_q(ns, "chord")) is not None:
            continue
        if _note_voice_staff(note, ns)[1] != staff:
            continue
        po = _read_play_order(note)
        if note.find(_q(ns, "rest")) is not None:
            if po is None:
                has_rest_without_po = True
        elif po is not None:
            has_pitched_with_po = True
    return has_rest_without_po and has_pitched_with_po


def _apply_timeline_play_orders_to_staff(measure: ET.Element, ns: str, staff: str) -> bool:
    """타임라인 기본 순번을 staff의 모든 leader(음·쉼)에 기록."""
    defaults = _default_play_orders_for_staff(measure, ns, staff)
    notes = list_note_elements(measure, ns)
    changed = False
    for i, order in defaults.items():
        if _set_play_order_on_leader(notes, ns, i, order):
            changed = True
    return changed


def normalize_play_orders_including_rests_in_measure(measure: ET.Element, ns: str) -> bool:
    """쉼표 순번이 빠진 채 음표만 순번이 있으면 마디 staff별 timeline으로 재배열."""
    notes = list_note_elements(measure, ns)
    staves = {_note_voice_staff(n, ns)[1] for n in notes if n.find(_q(ns, "chord")) is None}
    changed = False
    for staff in sorted(staves, key=lambda s: int(s) if s.isdigit() else 0):
        if not _staff_needs_rest_play_order_rebuild(measure, ns, staff):
            continue
        if _apply_timeline_play_orders_to_staff(measure, ns, staff):
            changed = True
    return changed


def normalize_play_orders_including_rests_in_root(root: ET.Element) -> int:
    """전 악보 — 쉼표 미포함 연주순번 마디를 timeline으로 재배열. 변경 마디 수."""
    ns = _ns(root)
    n = 0
    for part in root.findall(_q(ns, "part")):
        for measure in part.findall(_q(ns, "measure")):
            if normalize_play_orders_including_rests_in_measure(measure, ns):
                n += 1
    return n


def _timeline_el_duration(el: ET.Element, ns: str) -> int:
    dur_el = el.find(_q(ns, "duration"))
    if dur_el is None or not dur_el.text or not dur_el.text.strip().isdigit():
        return 0
    return int(dur_el.text.strip())


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
    slur_start_pl, slur_stop_pl = _note_slur_placements(note, ns)
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
    ornaments: list[str] = []
    fermatas: list[str] = []
    for notations in note.findall(_q(ns, "notations")):
        for tup in notations.findall(_q(ns, "tuplet")):
            tuplet = tup.get("type") or tuplet
        for arts in notations.findall(_q(ns, "articulations")):
            for art in arts:
                name = _local(art)
                placement = art.get("placement")
                dy = art.get("default-y")
                dist = art.get(ART_DISTANCE_ATTR)
                if placement and dist and dy:
                    articulations.append(f"{name}({placement},dist={dist},y={dy})")
                elif placement and dist:
                    articulations.append(f"{name}({placement},dist={dist})")
                elif placement and dy:
                    articulations.append(f"{name}({placement},y={dy})")
                elif placement:
                    articulations.append(f"{name}({placement})")
                elif dy:
                    articulations.append(f"{name}(y={dy})")
                else:
                    articulations.append(name)
        for orns in notations.findall(_q(ns, "ornaments")):
            for orn in orns:
                name = _local(orn)
                if name not in _ORNAMENT_TAGS:
                    continue
                placement = orn.get("placement")
                extra = (orn.get("type") or "").strip()
                label = f"{name}:{extra}" if extra else name
                ornaments.append(f"{label}({placement})" if placement else label)
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
        "slurStartPlacement": slur_start_pl,
        "slurStopPlacement": slur_stop_pl,
        "beams": _note_beams(note, ns),
        "stem": (stem_el.text or "").strip() if stem_el is not None and stem_el.text else None,
        "timeMod": time_mod,
        "tuplet": tuplet,
        "articulations": articulations,
        "ornaments": ornaments,
        "fermatas": fermatas,
        "defaultX": round(dx, 2) if dx is not None else None,
        "playOrder": _read_play_order(note),
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
    out: dict[str, Any] = {}
    dist = direction.get(DIR_DISTANCE_ATTR) or direction.get("data-hitl-art-distance")
    dy_str = direction.get("default-y")
    pl = (direction.get("placement") or "").strip().lower()

    dtype = direction.find(_q(ns, "direction-type"))
    if dtype is None:
        text = _direction_text(direction)
        out = {"directionType": "words", "directionValue": text or ""}
    else:
        dyn = dtype.find(_q(ns, "dynamics"))
        if dyn is not None:
            tags = [_local(c) for c in dyn if _local(c) in _DYNAMICS_TAGS]
            if tags:
                pl = (dyn.get("placement") or direction.get("placement") or _DEFAULT_DYNAMICS_PLACEMENT).strip().lower()
                dist = dyn.get(DIR_DISTANCE_ATTR) or dist
                dy_str = dyn.get("default-y") or dy_str
                out = {"directionType": "dynamics", "directionValue": tags[0]}
        
        if not out:
            has_segno_tag = any(dt.find(_q(ns, "segno")) is not None for dt in direction.findall(_q(ns, "direction-type")))
            has_coda_tag = any(dt.find(_q(ns, "coda")) is not None for dt in direction.findall(_q(ns, "direction-type")))

            # sound 속성 — MusicXML 표준 To Coda / Fine / D.C. / D.S.
            for sound in direction.findall(_q(ns, "sound")):
                if sound.get("tocoda"):
                    val = "비표준 기호 혼합(Coda)" if has_coda_tag else "tocoda"
                    out = {"directionType": "tocoda", "directionValue": val}
                    break
                if (sound.get("fine") or "").strip().lower() in ("yes", "true", "1"):
                    out = {"directionType": "fine", "directionValue": "fine"}
                    break
                if (sound.get("dacapo") or "").strip().lower() in ("yes", "true", "1"):
                    out = {"directionType": "dacapo", "directionValue": "dacapo"}
                    break
                if sound.get("dalsegno"):
                    val = "비표준 기호 혼합(Segno)" if has_segno_tag else "dalsegno"
                    out = {"directionType": "dalsegno", "directionValue": val}
                    break

        if not out:
            # 빈 <segno/> / <coda/> (To Coda의 뒤따르는 <coda/>는 sound/words로 이미 처리)
            for tag in ("segno", "coda"):
                if dtype.find(_q(ns, tag)) is not None:
                    words_txt = ""
                    for dt in direction.findall(_q(ns, "direction-type")):
                        w = dt.find(_q(ns, "words"))
                        if w is not None and w.text:
                            words_txt += " " + w.text.strip()
                    words_txt = words_txt.strip()
                    
                    if tag == "coda" and re.search(r"to\s*coda", words_txt, re.I):
                        out = {"directionType": "tocoda", "directionValue": "비표준 기호 혼합(To Coda+기호)"}
                        break
                        
                    val = tag
                    if words_txt:
                        if re.search(r"d\.s\.", words_txt, re.I) and tag == "segno":
                            val = "비표준 기호 혼합(D.S.+기호)"
                            tag = "dalsegno"
                        else:
                            val = f"{tag} + '{words_txt}'"
                            
                    out = {"directionType": tag, "directionValue": val}
                    break

        if not out:
            for tag in ("fine", "dacapo", "dalsegno", "tocoda"):
                if dtype.find(_q(ns, tag)) is not None:
                    out = {"directionType": tag, "directionValue": tag}
                    break

        if not out:
            words = dtype.find(_q(ns, "words"))
            if words is not None and words.text and words.text.strip():
                txt = words.text.strip()
                dist = words.get(DIR_DISTANCE_ATTR) or dist
                dy_str = words.get("default-y") or dy_str
                low = txt.lower()
                if re.search(r"to\s*coda", low):
                    out = {"directionType": "tocoda", "directionValue": "tocoda"}
                elif re.fullmatch(r"fine", low):
                    out = {"directionType": "fine", "directionValue": "fine"}
                elif re.fullmatch(r"d\.?\s*c\.?", low) or low.startswith("d.c"):
                    out = {"directionType": "dacapo", "directionValue": "dacapo"}
                elif re.fullmatch(r"d\.?\s*s\.?", low) or low.startswith("d.s"):
                    out = {"directionType": "dalsegno", "directionValue": "dalsegno"}
                else:
                    out = {"directionType": "words", "directionValue": txt}

        if not out:
            reh = dtype.find(_q(ns, "rehearsal"))
            if reh is not None:
                dist = reh.get(DIR_DISTANCE_ATTR) or dist
                dy_str = reh.get("default-y") or dy_str
                out = {"directionType": "rehearsal", "directionValue": (reh.text or "A").strip()}

        if not out:
            wedge_type = _wedge_type_of(direction, ns)
            if wedge_type:
                out = {"directionType": "wedge", "directionValue": wedge_type}

        if not out:
            text = _direction_text(direction)
            out = {"directionType": "words", "directionValue": text or ""}

    if pl in ("above", "below"):
        out["placement"] = pl
    if dist:
        out["distance"] = dist
    if dy_str:
        try:
            out["defaultY"] = int(round(float(dy_str)))
        except (ValueError, TypeError):
            pass
    return out


def _read_note_direction_from_notations(note: ET.Element, ns: str) -> dict[str, Any] | None:
    for notations in note.findall(_q(ns, "notations")):
        dyn = notations.find(_q(ns, "dynamics"))
        if dyn is None:
            continue
        tags = [_local(c) for c in dyn if _local(c) in _DYNAMICS_TAGS]
        if tags:
            pl = (dyn.get("placement") or _DEFAULT_DYNAMICS_PLACEMENT).strip()
            dist = dyn.get(DIR_DISTANCE_ATTR) or dyn.get("data-hitl-art-distance")
            dy_str = dyn.get("default-y")
            out: dict[str, Any] = {"directionType": "dynamics", "directionValue": tags[0]}
            if pl in ("above", "below"):
                out["placement"] = pl
            if dist:
                out["distance"] = dist
            if dy_str:
                try:
                    out["defaultY"] = int(round(float(dy_str)))
                except (ValueError, TypeError):
                    pass
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
    # OSMD는 direction-type 없이 <sound tempo>만 있으면 길이 0 pickup 마디를 만들고
    # 같은 마디 음표를 버린다. 숨김 파트도 metronome은 반드시 둔다.
    if not show_metronome:
        direction.set("print-object", "no")
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
    if metro is None:
        dtype = direction.find(_q(ns, "direction-type"))
        if dtype is None:
            dtype = ET.Element(_q(ns, "direction-type"))
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
    if show_metronome:
        if direction.get("print-object") == "no":
            del direction.attrib["print-object"]
    else:
        direction.set("print-object", "no")
    sound = direction.find(_q(ns, "sound"))
    if sound is None:
        sound = ET.SubElement(direction, _q(ns, "sound"))
    sound.set("tempo", bpm_str)
    for el in direction.iter():
        if _local(el) == "per-minute" and el.text is not None:
            el.text = bpm_str


def _measure_header_insert_index(measure: ET.Element) -> int:
    """Leading ``<print>`` / ``<attributes>`` / ``<direction>`` 블록 직후 삽입 인덱스."""
    insert_at = 0
    for i, child in enumerate(measure):
        loc = _local(child)
        if loc in ("print", "attributes", "direction"):
            insert_at = i + 1
        else:
            break
    return insert_at


def _reposition_directions_before_first_attributes(
    measure: ET.Element, ns: str, *, tempo_only: bool = False
) -> int:
    """Move directions before the first ``<attributes>`` to after the header block."""
    children = list(measure)
    first_attr = next(
        (i for i, child in enumerate(children) if _local(child) == "attributes"),
        None,
    )
    if first_attr is None:
        return 0
    insert_at = _measure_header_insert_index(measure)
    moved = 0
    for i, child in enumerate(children):
        if i >= first_attr:
            break
        if _local(child) != "direction":
            continue
        if tempo_only and not _direction_has_tempo(child, ns):
            continue
        measure.remove(child)
        insert_at = _measure_header_insert_index(measure)
        measure.insert(insert_at, child)
        moved += 1
    return moved


def _measure_end_before_barline_index(measure: ET.Element) -> int:
    for i, child in enumerate(measure):
        if _local(child) != "barline":
            continue
        loc = (child.get("location") or "right").strip().lower()
        if loc in ("right", ""):
            return i
    return len(measure)


def _tempo_insert_index(measure: ET.Element) -> int:
    """Insert tempo after header, before first note/forward/backup (or append)."""
    has_attr = any(_local(c) == "attributes" for c in measure)
    if not has_attr:
        # attributes 없는 파트 m1 — 맨 앞 direction은 OSMD pickup/빈 마디 유발 → 마디 끝에 sound tempo
        return _measure_end_before_barline_index(measure)
    header_end = _measure_header_insert_index(measure)
    insert_at = header_end
    for i, child in enumerate(measure):
        if i < header_end:
            continue
        if _local(child) in ("note", "forward", "backup"):
            return i
        insert_at = i + 1
    return insert_at


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
        # Move target to correct position
        measure.remove(target)
        new_dir = target
    else:
        new_dir = _build_tempo_direction(ns, bpm, beat_unit, show_metronome=show_metronome)

    measure.insert(_tempo_insert_index(measure), new_dir)
    _reposition_directions_before_first_attributes(measure, ns, tempo_only=True)
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
    try:
        staff_n = int(staff)
    except (ValueError, TypeError):
        staff_n = 1
    voice = snap.get("voice") or "1"
    try:
        voice_n = int(voice)
    except (ValueError, TypeError):
        voice_n = 1
    po = snap.get("playOrder")
    if po is None:
        po = snap.get("displayPlayOrder")
    try:
        po_val = int(po) if po is not None and int(po) > 0 else 999_999
    except (ValueError, TypeError):
        po_val = 999_999
    idx = int(snap.get("index") or 0)
    return (staff_n, voice_n, po_val, idx, 0 if not snap.get("chord") else 1)


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
    # 옛 전파로 같은 po가 여러 onset에 남은 MXL을 편집 UI·미리보기 전에 정리
    _sanitize_conflicting_play_orders(measure, ns)
    # 음표만 순번이 있고 쉼표는 빠진 옛 MXL → timeline 기준으로 재배열
    normalize_play_orders_including_rests_in_measure(measure, ns)
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
    staff_keys = sorted(
        {
            int(s.get("staff")) if s.get("staff") is not None else 1
            for s in elements
            if not s.get("chord")
        }
    )
    for staff_n in staff_keys:
        defaults = _default_play_orders_for_staff(measure, ns, str(staff_n))
        for snap in elements:
            if snap.get("chord"):
                continue
            snap_staff = int(snap["staff"]) if snap.get("staff") is not None else 1
            if snap_staff != staff_n:
                continue
            idx = int(snap["index"])
            snap["defaultPlayOrder"] = defaults.get(idx)
            if snap.get("playOrder") is None:
                snap["displayPlayOrder"] = defaults.get(idx)
            else:
                snap["displayPlayOrder"] = snap.get("playOrder")
    elements.sort(key=_snapshot_timeline_sort_key)
    return elements


def _effective_clef_for_measure(part: ET.Element, ns: str, measure_mxl: str, staff_n: int = 1) -> dict[str, Any] | None:
    measures = part.findall(_q(ns, "measure"))
    target_idx = None
    for idx, m in enumerate(measures):
        if m.get("number") == str(measure_mxl):
            target_idx = idx
            break
    if target_idx is None:
        target_idx = len(measures) - 1
    last_clef = None
    for i in range(target_idx + 1):
        m = measures[i]
        for attr in m.findall(_q(ns, "attributes")):
            for clef in attr.findall(_q(ns, "clef")):
                c_staff = clef.get("number")
                if c_staff is None or c_staff == str(staff_n) or staff_n == 1:
                    sign = clef.find(_q(ns, "sign"))
                    line = clef.find(_q(ns, "line"))
                    if sign is not None and sign.text:
                        s_text = sign.text.strip().upper()
                        l_text = int(line.text.strip()) if line is not None and line.text and line.text.strip().isdigit() else (2 if s_text == "G" else 4)
                        last_clef = {"sign": s_text, "line": l_text}
    return last_clef


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
    effective_clef = _effective_clef_for_measure(part, ns, measure_mxl)
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
        "effectiveClef": effective_clef,
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


def _set_rest_display_step_octave(
    rest_el: ET.Element, ns: str, step: str, octave: int
) -> bool:
    """쉼표 display-step/octave를 오선 위치로 맞춘다. 바뀌면 True."""
    step_el = rest_el.find(_q(ns, "display-step"))
    oct_el = rest_el.find(_q(ns, "display-octave"))
    changed = False
    if step_el is None:
        step_el = ET.SubElement(rest_el, _q(ns, "display-step"))
        changed = True
    if (step_el.text or "").strip() != step:
        step_el.text = step
        changed = True
    if oct_el is None:
        oct_el = ET.SubElement(rest_el, _q(ns, "display-octave"))
        changed = True
    if (oct_el.text or "").strip() != str(octave):
        oct_el.text = str(octave)
        changed = True
    return changed


def _note_staff_number(note: ET.Element, ns: str) -> int | None:
    staff_el = note.find(_q(ns, "staff"))
    if staff_el is None or staff_el.text is None or not staff_el.text.strip().isdigit():
        return None
    return int(staff_el.text.strip())


_STEP_DIATONIC = {"C": 0, "D": 1, "E": 2, "F": 3, "G": 4, "A": 5, "B": 6}


def _pitch_diatonic(note: ET.Element, ns: str) -> int | None:
    pitch = note.find(_q(ns, "pitch"))
    if pitch is None:
        return None
    step_el = pitch.find(_q(ns, "step"))
    oct_el = pitch.find(_q(ns, "octave"))
    if step_el is None or oct_el is None or not step_el.text or not oct_el.text:
        return None
    step = step_el.text.strip()
    if step not in _STEP_DIATONIC:
        return None
    try:
        octave = int(oct_el.text.strip())
    except ValueError:
        return None
    return octave * 7 + _STEP_DIATONIC[step]


def _middle_line_diatonic(clef_sign: str, clef_line: int = 2) -> int:
    sign = (clef_sign or "G").strip().upper()
    if sign == "F":
        return 3 * 7 + 1  # D3
    if sign == "C":
        if clef_line == 4:
            return 3 * 7 + 5  # A3 tenor
        return 4 * 7 + 0  # C4 alto
    return 4 * 7 + 6  # B4 treble


def _clef_for_note_in_part(
    part: ET.Element | None, measure: ET.Element | None, note: ET.Element, ns: str
) -> tuple[str, int]:
    """직전 attributes clef — staff number에 맞추고 없으면 G/2."""
    staff_n = _note_staff_number(note, ns) or 1
    clef_sign, clef_line = "G", 2
    measures: list[ET.Element] = []
    if part is not None:
        for m in part.findall(_q(ns, "measure")):
            measures.append(m)
            if measure is not None and m is measure:
                break
    elif measure is not None:
        measures = [measure]
    for m in measures:
        for attrs in m.findall(_q(ns, "attributes")):
            for clef in attrs.findall(_q(ns, "clef")):
                num = clef.get("number")
                if num and num.isdigit() and int(num) != staff_n:
                    continue
                if num is None and staff_n != 1:
                    continue
                sign_el = clef.find(_q(ns, "sign"))
                line_el = clef.find(_q(ns, "line"))
                if sign_el is not None and sign_el.text:
                    clef_sign = sign_el.text.strip()
                if line_el is not None and line_el.text and line_el.text.strip().isdigit():
                    clef_line = int(line_el.text.strip())
    return clef_sign, clef_line


def _tie_placement_for_note(
    note: ET.Element,
    ns: str,
    *,
    part: ET.Element | None = None,
    measure: ET.Element | None = None,
    clef_sign: str | None = None,
    clef_line: int | None = None,
) -> str:
    """오선 중선 이상·줄기 down → above, 그 외 below (OSMD tied@placement)."""
    if clef_sign is None or clef_line is None:
        cs, cl = _clef_for_note_in_part(part, measure, note, ns)
        clef_sign = clef_sign or cs
        clef_line = clef_line if clef_line is not None else cl
    dia = _pitch_diatonic(note, ns)
    mid = _middle_line_diatonic(clef_sign, clef_line)
    if dia is not None and dia >= mid:
        return "above"
    stem_el = note.find(_q(ns, "stem"))
    stem = (stem_el.text or "").strip().lower() if stem_el is not None else ""
    if stem == "down":
        return "above"
    return "below"


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
            x_val = max(1.0, fx - 15.0)
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
    if x_val is not None:
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


def _insert_direction_at_measure_end(measure: ET.Element, ns: str, new_dir: ET.Element) -> None:
    """마디 끝 — 오른쪽 ⟨barline⟩ 직전(없으면 append). backup 뒤 음표보다 뒤라 OSMD가 다음 마디로 밀지 않음."""
    children = list(measure)
    for i, child in enumerate(children):
        if _local(child) != "barline":
            continue
        loc = (child.get("location") or "right").strip().lower()
        if loc in ("right", ""):
            measure.insert(i, new_dir)
            return
    measure.append(new_dir)


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


def _note_slur_placement_flags(note: ET.Element, ns: str) -> tuple[bool, bool]:
    """이 음표 notations slur — placement 없으면 줄기 반대(머리) 쪽으로 추정."""
    has_below = False
    has_above = False
    stem_el = note.find(_q(ns, "stem"))
    stem_dir = (stem_el.text or "").strip().lower() if stem_el is not None and stem_el.text else ""
    for nots in note.findall(_q(ns, "notations")):
        for slur in nots.findall(_q(ns, "slur")):
            spl = (slur.get("placement") or "").strip().lower()
            if spl == "below":
                has_below = True
            elif spl == "above":
                has_above = True
            elif stem_dir == "up":
                has_below = True
            elif stem_dir == "down":
                has_above = True
            else:
                has_below = True
                has_above = True
    return has_below, has_above


ART_DISTANCE_ATTR = "data-hitl-art-distance"
ARTICULATION_STAFF_GAP_BASE = 10


def _articulation_distance_from_el(el: ET.Element) -> str | None:
    raw = el.get(ART_DISTANCE_ATTR)
    if raw in (None, "", "auto"):
        return None
    return str(raw).strip().lower()


def _set_articulation_distance_on_el(el: ET.Element, dist: str | None) -> None:
    if dist in (None, "", "auto"):
        el.attrib.pop(ART_DISTANCE_ATTR, None)
DIR_DISTANCE_ATTR = "data-hitl-dir-distance"


def _articulation_staff_spaces(dist: str | None) -> float:
    d = (dist or "").strip().lower()
    if d in (None, "", "auto"):
        return 2.5
    if d == "very-far":
        return 5.0
    if d == "far":
        return 4.0
    if d == "close":
        return 1.0
    import re

    m = re.match(r"^(?:spaces?[:x])?(\d+(?:\.\d+)?)$", d.replace(" ", ""))
    if m:
        return float(m.group(1))
    return 2.5


def _articulation_tier_multiplier(dist: str | None) -> float:
    return _articulation_staff_spaces(dist)


def _set_direction_distance_on_el(el: ET.Element, dist: str | None) -> None:
    if dist in (None, "", "auto"):
        if DIR_DISTANCE_ATTR in el.attrib:
            del el.attrib[DIR_DISTANCE_ATTR]
    else:
        el.set(DIR_DISTANCE_ATTR, dist)


def _calc_direction_default_y(placement: str, distance: str | None = None) -> int:
    spaces = _articulation_staff_spaces(distance)
    mag = int(round(ARTICULATION_STAFF_GAP_BASE * spaces))
    return -mag if placement == "below" else mag


def _calc_safe_articulation_default_y(
    note: ET.Element,
    ns: str,
    placement: str,
    distance: str | None = None,
    custom_dy: int | float | None = None,
) -> int | None:
    """오선 한 칸(10 tenths)×tier 배수 tenths."""
    if custom_dy is not None:
        try:
            return int(round(float(custom_dy)))
        except (ValueError, TypeError):
            pass

    mag = int(round(ARTICULATION_STAFF_GAP_BASE * _articulation_staff_spaces(distance)))
    if placement == "below":
        return -mag
    if placement == "above":
        return mag
    return None


def _normalize_articulation_engraving_on_note(note: ET.Element, ns: str) -> bool:
    """HITL articulation — placement·default-y 누락 시 slur·stem 기준으로 보강."""
    if note.find(_q(ns, "rest")) is not None:
        return False
    changed = False
    for notations in note.findall(_q(ns, "notations")):
        for arts in notations.findall(_q(ns, "articulations")):
            for el in arts:
                tag = _local(el).lower().replace("_", "-")
                if tag not in _ARTICULATION_TAGS:
                    continue
                placement = (el.get("placement") or "").strip().lower()
                if placement not in ("above", "below"):
                    placement = _default_articulation_placement(note, ns) or "below"
                    el.set("placement", placement)
                    changed = True
                dist = _articulation_distance_from_el(el)
                dy_raw = el.get("default-y")
                target = _calc_safe_articulation_default_y(note, ns, placement, distance=dist)
                if target is not None:
                    if dist and (dy_raw is None or not str(dy_raw).strip() or str(dy_raw).strip() != str(target)):
                        el.set("default-y", str(target))
                        changed = True
                    elif dy_raw is None or not str(dy_raw).strip():
                        el.set("default-y", str(target))
                        changed = True
                    else:
                        try:
                            current = int(float(str(dy_raw).strip()))
                            has_below, has_above = _note_slur_placement_flags(note, ns)
                            if placement == "below" and has_below and current > target:
                                el.set("default-y", str(target))
                                changed = True
                            elif placement == "above" and has_above and current < target:
                                el.set("default-y", str(target))
                                changed = True
                        except ValueError:
                            el.set("default-y", str(target))
                            changed = True
    return changed


def normalize_articulations_in_root(root: ET.Element) -> int:
    """전 악보 — articulation default-y/placement 누락 보강. 변경 note 수 반환."""
    ns = _ns(root)
    changed_notes = 0
    for part in root.findall(_q(ns, "part")):
        for measure in part.findall(_q(ns, "measure")):
            for note in list_note_elements(measure, ns):
                if _normalize_articulation_engraving_on_note(note, ns):
                    changed_notes += 1
    return changed_notes


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
    dstaff = _direction_staff_number(direction, ns)
    if dstaff is not None:
        return dstaff
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
    return default


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
    distance: str | None = None,
) -> bool:
    if note_idx < 0 or note_idx >= len(notes):
        return False
    note = notes[note_idx]
    kind = (direction_type or "words").strip().lower()
    val = str(direction_value or "").strip()
    pl = placement or ("below" if kind == "dynamics" else "above")
    dy = _calc_direction_default_y(pl, distance)
    if kind == "dynamics":
        tag = val.lower() or "p"
        _attach_dynamics_to_note(note, ns, tag, pl)
        # notations/dynamics에 default-y 및 distance 설정
        for nots in note.findall(_q(ns, "notations")):
            for dyn in nots.findall(_q(ns, "dynamics")):
                dyn.set("placement", pl)
                dyn.set("default-y", str(dy))
                _set_direction_distance_on_el(dyn, distance)
        return True
    if not val and kind == "words":
        val = " "
    staff_n = _note_staff_number(note, ns)
    new_dir = _build_direction_element(
        ns,
        kind,
        val,
        staff_n=staff_n,
        placement=pl,
    )
    new_dir.set("default-y", str(dy))
    _set_direction_distance_on_el(new_dir, distance)
    dtype = new_dir.find(_q(ns, "direction-type"))
    if dtype is not None:
        for child in dtype:
            child.set("default-y", str(dy))
    _insert_before_note_element(measure, ns, new_dir, note_idx)
    _attach_voice_to_direction_from_note(new_dir, ns, note)
    _copy_layout_from_note_to_direction(new_dir, note)
    return True


def _migrate_directions_to_notes(measure: ET.Element, ns: str) -> bool:
    """measure-level `<direction>` 을 anchor 음표 속성(notations·앞 direction)으로 통일.
    진행 제어(Segno·Coda·To Coda·Fine·D.C./D.S.)는 마디 처음/끝 위치를 유지 — 음표에 붙이지 않음."""
    changed = False
    for direction in list(measure.findall(_q(ns, "direction"))):
        info = _direction_element_info(direction, ns)
        dtype_kind = str(info.get("directionType") or "")
        if dtype_kind in _NAVIGATION_DIRECTION_TAGS or _is_navigation_direction_type(dtype_kind):
            continue
        if dtype_kind == "words":
            val = str(info.get("directionValue") or "")
            if re.search(r"^(D\.(C|S)\.|To Coda|Fine\b)", val, re.I):
                continue
        anchor = _anchor_note_for_direction(measure, direction, ns)
        if anchor is None:
            continue
        dtype = direction.find(_q(ns, "direction-type"))
        dyn = dtype.find(_q(ns, "dynamics")) if dtype is not None else None
        if dyn is not None:
            # 셈여림표(p, f, mf 등)는 음표의 notation으로 흡수하지 않고 독립 direction으로 유지
            # placement에 맞는 default-y 여백(above: 25, below: -65)을 보장
            pl = direction.get("placement") or dyn.get("placement") or _DEFAULT_DYNAMICS_PLACEMENT
            direction.set("placement", pl)
            if pl == "above":
                direction.set("default-y", "25")
                dyn.set("default-y", "25")
            elif pl == "below":
                direction.set("default-y", "-65")
                dyn.set("default-y", "-65")

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
    ns = _ns(measure)
    # wedge(stop)은 끝나는 음의 뒤(attachment)에 붙어야 하므로 앞선 음의 preamble로 취급하지 않음
    if _wedge_type_of(direction, ns) == "stop":
        return False
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
    if not leaders or expected < 2 or len(leaders) >= expected:
        return leaders
    out = list(leaders)
    idx = out[-1]
    is_grace = notes[idx].find(_q(ns, "grace")) is not None
    while len(out) < expected and idx + 1 < len(notes):
        idx += 1
        n = notes[idx]
        n_grace = n.find(_q(ns, "grace")) is not None
        if n_grace != is_grace:
            break
        if _is_beamable_pitched_note(n, ns):
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


def _beam_count_for_note_type(note_type: str) -> int:
    return {"eighth": 1, "16th": 2, "32nd": 3, "64th": 4, "128th": 5}.get(note_type, 1)


def _apply_grace_beams(notes: list[ET.Element], ns: str) -> None:
    if len(notes) < 2:
        return
    for n in notes:
        _strip_beams_from_note(n, ns, None)

    counts = [
        _beam_count_for_note_type(
            (n.find(_q(ns, "type")).text or "eighth").strip()
            if n.find(_q(ns, "type")) is not None and n.find(_q(ns, "type")).text
            else "eighth"
        )
        for n in notes
    ]
    max_b = max(counts)

    for b_idx in range(1, max_b + 1):
        run_indices = []
        for i, cnt in enumerate(counts):
            if cnt >= b_idx:
                run_indices.append(i)
            else:
                if len(run_indices) >= 2:
                    _set_beam_on_note(notes[run_indices[0]], ns, b_idx, "begin")
                    for mid in run_indices[1:-1]:
                        _set_beam_on_note(notes[mid], ns, b_idx, "continue")
                    _set_beam_on_note(notes[run_indices[-1]], ns, b_idx, "end")
                elif len(run_indices) == 1:
                    if run_indices[0] == 0:
                        _set_beam_on_note(notes[run_indices[0]], ns, b_idx, "forward hook")
                    else:
                        _set_beam_on_note(notes[run_indices[0]], ns, b_idx, "backward hook")
                run_indices = []
        if len(run_indices) >= 2:
            _set_beam_on_note(notes[run_indices[0]], ns, b_idx, "begin")
            for mid in run_indices[1:-1]:
                _set_beam_on_note(notes[mid], ns, b_idx, "continue")
            _set_beam_on_note(notes[run_indices[-1]], ns, b_idx, "end")
        elif len(run_indices) == 1:
            if run_indices[0] == 0:
                _set_beam_on_note(notes[run_indices[0]], ns, b_idx, "forward hook")
            else:
                _set_beam_on_note(notes[run_indices[0]], ns, b_idx, "backward hook")



def _clean_orphan_beams_in_measure(measure: ET.Element, ns: str) -> bool:
    """staff/voice별 유효하지 않은 고아 빔(시작만 있고 끝이 없는 단독 빔 등) 자동 제거."""
    notes = list_note_elements(measure, ns)
    changed = False
    by_layer: dict[tuple[str, str], list[ET.Element]] = {}
    for n in notes:
        if n.find(_q(ns, "chord")) is not None or n.find(_q(ns, "rest")) is not None:
            continue
        v, st = _note_voice_staff(n, ns)
        by_layer.setdefault((st, v), []).append(n)

    for (st, v), layer_notes in by_layer.items():
        all_numbers: set[int] = set()
        for n in layer_notes:
            for b in n.findall(_q(ns, "beam")):
                try:
                    all_numbers.add(int(b.get("number") or "1"))
                except ValueError:
                    all_numbers.add(1)
        for b_num in sorted(all_numbers):
            active_run: list[ET.Element] = []
            for n in layer_notes:
                b_el = None
                for b in n.findall(_q(ns, "beam")):
                    try:
                        num = int(b.get("number") or "1")
                    except ValueError:
                        num = 1
                    if num == b_num:
                        b_el = b
                        break
                if b_el is None:
                    if active_run:
                        for r_note in active_run:
                            if _strip_beams_from_note(r_note, ns, b_num):
                                changed = True
                        active_run = []
                    continue
                val = (b_el.text or "").strip().lower()
                if val == "begin":
                    if active_run:
                        for r_note in active_run:
                            if _strip_beams_from_note(r_note, ns, b_num):
                                changed = True
                    active_run = [n]
                elif val in ("continue", "forward hook", "backward hook"):
                    if not active_run:
                        if _strip_beams_from_note(n, ns, b_num):
                            changed = True
                    else:
                        active_run.append(n)
                elif val == "end":
                    if not active_run:
                        if _strip_beams_from_note(n, ns, b_num):
                            changed = True
                    else:
                        active_run.append(n)
                        if len(active_run) < 2:
                            for r_note in active_run:
                                if _strip_beams_from_note(r_note, ns, b_num):
                                    changed = True
                        active_run = []
            if active_run:
                for r_note in active_run:
                    if _strip_beams_from_note(r_note, ns, b_num):
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


def _dedupe_identical_pitches_in_chord_groups(measure: ET.Element, ns: str) -> int:
    """같은 화음 그룹에서 step·octave·alter가 같은 멤버는 하나만 남긴다(OMR 유니즌 중복)."""
    notes = list_note_elements(measure, ns)
    to_remove: list[ET.Element] = []
    i = 0
    while i < len(notes):
        note = notes[i]
        if note.find(_q(ns, "chord")) is not None or _is_grace_or_cue(note, ns):
            i += 1
            continue
        seen: set[tuple[str, int, int]] = set()
        key = _note_pitch_key(note, ns)
        if key is not None:
            seen.add(key)
        for j in _chord_follower_indices(notes, ns, i):
            member = notes[j]
            mkey = _note_pitch_key(member, ns)
            if mkey is None:
                continue
            if mkey in seen:
                to_remove.append(member)
            else:
                seen.add(mkey)
        i += 1
    for el in to_remove:
        if el in list(measure):
            measure.remove(el)
    return len(to_remove)


def dedupe_identical_chord_pitches_in_root(root: ET.Element) -> int:
    """전 악보 — 화음 내 동일 피치 중복 제거. 변경 마디 수."""
    ns = _ns(root)
    n = 0
    for part in root.findall(_q(ns, "part")):
        for measure in part.findall(_q(ns, "measure")):
            if _dedupe_identical_pitches_in_chord_groups(measure, ns):
                n += 1
    return n


def _compact_default_x_by_staff(
    measure: ET.Element, ns: str, part: ET.Element | None = None
) -> bool:
    """voice timeline 시작이 같은 음은 같은 default-x — 동시 시작(다른 박자·줄기) 정렬."""
    notes = list_note_elements(measure, ns)
    divisions, beats, beat_type = _measure_divisions_beats(measure, ns, part)
    measure_len = max(1, _measure_length_units(divisions, beats, beat_type))
    changed = False
    base_x = 32.0
    span = 400.0
    for staff in ("1", "2"):
        timed = _staff_timed_leader_starts(measure, ns, staff)
        if not timed:
            continue
        for ni, start in timed:
            if _is_grace_or_cue(notes[ni], ns):
                continue
            x = base_x + (min(start, measure_len) / measure_len * span)
            new_x = f"{x:.2f}"
            group = [notes[ni], *[notes[j] for j in _chord_follower_indices(notes, ns, ni)]]
            for note in group:
                if note.get("default-x") != new_x:
                    note.set("default-x", new_x)
                    changed = True
    return changed


def _compact_default_x_by_voice(
    measure: ET.Element, ns: str, part: ET.Element | None = None
) -> bool:
    return _compact_default_x_by_staff(measure, ns, part)


def _timeline_el_duration(el: ET.Element, ns: str) -> int:
    dur_el = el.find(_q(ns, "duration"))
    if dur_el is None or not dur_el.text:
        return 0
    try:
        return max(0, int(dur_el.text.strip()))
    except ValueError:
        return 0


def _musicxml_leader_onsets(measure: ET.Element, ns: str) -> dict[ET.Element, int]:
    """MusicXML 단일 cursor(backup/forward) 기준 leader onset."""
    cursor = 0
    out: dict[ET.Element, int] = {}
    for el in list(measure):
        loc = _local(el)
        if loc == "backup":
            cursor = max(0, cursor - _timeline_el_duration(el, ns))
        elif loc == "forward":
            cursor += _timeline_el_duration(el, ns)
        elif loc == "note":
            if el.find(_q(ns, "chord")) is not None or _is_grace_or_cue(el, ns):
                continue
            out[el] = cursor
            cursor += _note_duration(el, ns)
    return out


def _guess_type_for_duration(dur: int, divisions: int) -> str | None:
    if dur <= 0 or divisions <= 0:
        return None
    for note_type in ("whole", "half", "quarter", "eighth", "16th", "32nd", "64th"):
        for dots in (0, 1, 2):
            if _duration_for_type_dots(note_type, divisions, dots) == dur:
                return note_type
    return None


def _closest_type_for_duration(dur: int, divisions: int) -> tuple[str, int]:
    """표준 type이 없으면 가장 가까운 type·dot. gap 쉼표 포기하지 않기 위함."""
    exact = _guess_type_for_duration(dur, divisions)
    if exact is not None:
        for dots in (0, 1, 2):
            if _duration_for_type_dots(exact, divisions, dots) == dur:
                return exact, dots
        return exact, 0
    best: tuple[str, int, int] | None = None  # type, dots, abserr
    for note_type in ("whole", "half", "quarter", "eighth", "16th", "32nd", "64th"):
        for dots in (0, 1, 2):
            d = _duration_for_type_dots(note_type, divisions, dots)
            if d <= 0:
                continue
            err = abs(d - dur)
            if best is None or err < best[2]:
                best = (note_type, dots, err)
    if best is None:
        return "eighth", 0
    return best[0], best[1]


def _measure_divisions_beats(
    measure: ET.Element, ns: str, part: ET.Element | None = None
) -> tuple[int, int, int]:
    if part is not None:
        return _effective_divisions_and_time(part, ns, measure)
    divisions, beats, beat_type = 1, 4, 4
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
    return divisions, beats, beat_type


def _staff_voice_layer_meta(
    measure: ET.Element, ns: str, staff: str
) -> dict[str, tuple[int, int, list[ET.Element]]]:
    """voice → (first_onset, layer_dur, leaders). onset은 전체 MusicXML cursor."""
    full_onsets = _musicxml_leader_onsets(measure, ns)
    by_voice: dict[str, list[ET.Element]] = {}
    for el in list(measure):
        if _local(el) != "note":
            continue
        if el.find(_q(ns, "chord")) is not None or _is_grace_or_cue(el, ns):
            continue
        v, st = _note_voice_staff(el, ns)
        if st != staff:
            continue
        by_voice.setdefault(v, []).append(el)
    out: dict[str, tuple[int, int, list[ET.Element]]] = {}
    for v, leaders in by_voice.items():
        layer_dur = _voice_layer_duration(leaders, ns)
        o0 = full_onsets.get(leaders[0], 0)
        out[v] = (o0, layer_dur, leaders)
    return out


def _coalesce_spurious_parallel_voices_on_staff(
    measure: ET.Element,
    ns: str,
    staff: str,
    *,
    divisions: int,
    measure_len: int,
) -> bool:
    """Audiveris가 같은 staff에 둔 가짜 병렬/잘린 voice를 underfull primary에 흡수.

    예: PL voice5(전반) + voice6(전마디 병렬) + voice7(후반·잘못된 voice)
    → voice7→voice5, gap이면 쉼표 삽입.
    """
    if measure_len <= 0 or divisions <= 0:
        return False
    meta = _staff_voice_layer_meta(measure, ns, staff)
    voices = set(meta.keys())
    if len(voices) < 3:
        return False

    voice_list = sorted(voices, key=lambda v: int(v) if v.isdigit() else 999)
    primary = voice_list[0]
    p_start, p_dur, _pleaders = meta[primary]
    if p_dur <= 0 or p_dur >= measure_len:
        return False
    p_end = p_start + p_dur

    tol = max(3, divisions // 4)
    parallel: list[str] = []
    candidates: list[str] = []
    for v in voice_list[1:]:
        start, dur, _leaders = meta[v]
        if dur <= 0:
            continue
        # 전마디에 가까운 층 → 진짜 병렬(유지)
        if dur >= max(1, int(measure_len * 0.66 + 0.5)):
            parallel.append(v)
            continue
        # onset 0에 잘못 겹친 짧은 층, 또는 primary 끝에서 이어지는 잘못된 voice
        if p_dur + dur <= measure_len + tol:
            if (
                start <= p_start + tol
                or start >= p_start + (p_dur // 2)
                or start >= p_end - tol
            ):
                candidates.append(v)
    if not parallel or not candidates:
        return False

    remaining = measure_len - p_dur
    candidates.sort(key=lambda v: (meta[v][0], int(v) if v.isdigit() else 999))
    absorbed_voices: list[str] = []
    absorbed_dur = 0
    for v in candidates:
        _start, dur, _leaders = meta[v]
        if dur > remaining - absorbed_dur + tol:
            continue
        absorbed_voices.append(v)
        absorbed_dur += dur
    if not absorbed_voices:
        return False

    first_v = absorbed_voices[0]
    first_start = meta[first_v][0]
    if first_start <= p_start + tol:
        # false-parallel at measure start — fill remaining with leading rest if needed
        gap = max(0, remaining - absorbed_dur)
    else:
        raw_gap = first_start - p_end
        gap = raw_gap if raw_gap > tol else 0

    first_absorbed = meta[first_v][2][0]
    for v in absorbed_voices:
        for note in list_note_elements(measure, ns):
            nv, st = _note_voice_staff(note, ns)
            if st == staff and nv == v:
                _set_note_voice_staff(note, ns, primary, staff)

    if gap > 0:
        gap_type, gap_dots = _closest_type_for_duration(gap, divisions)
        rest = _build_inserted_rest_note(
            ns,
            rest_type=gap_type,
            divisions=divisions,
            staff_n=int(staff) if staff.isdigit() else 1,
            voice=primary,
            dot_count=gap_dots,
        )
        # duration을 gap에 맞게 강제(근사 type이어도 박자는 맞춤)
        dur_el = rest.find(_q(ns, "duration"))
        if dur_el is not None:
            dur_el.text = str(gap)
        parent_idx = list(measure).index(first_absorbed)
        measure.insert(parent_idx, rest)

    _rebuild_staff_voice_block(measure, ns, staff, primary_voice=primary)
    return True


def coalesce_spurious_parallel_voices_in_measure(
    measure: ET.Element, ns: str, part: ET.Element | None = None
) -> bool:
    divisions, beats, beat_type = _measure_divisions_beats(measure, ns, part)
    measure_len = _measure_length_units(divisions, beats, beat_type)
    changed = False
    for staff in ("1", "2"):
        if _coalesce_spurious_parallel_voices_on_staff(
            measure, ns, staff, divisions=divisions, measure_len=measure_len
        ):
            changed = True
    return changed


def coalesce_spurious_parallel_voices_in_root(root: ET.Element) -> int:
    """전 악보 — 가짜 병렬 voice 흡수. 변경된 마디 수 반환."""
    ns = _ns(root)
    n = 0
    for part in root.findall(_q(ns, "part")):
        for measure in part.findall(_q(ns, "measure")):
            if coalesce_spurious_parallel_voices_in_measure(measure, ns, part):
                n += 1
    return n


def normalize_measure_timelines_in_root(root: ET.Element) -> int:
    """전 악보 — 다중 성부 및 분절 성부 스트림 통합·타임라인 재배열. 변경된 마디 수 반환."""
    ns = _ns(root)
    n = 0
    for part in root.findall(_q(ns, "part")):
        for measure in part.findall(_q(ns, "measure")):
            if _measure_has_multivoice_layers(measure, ns):
                rebuild_measure_timeline_clean(measure, ns, part)
                n += 1
    return n


def normalize_slurs_in_root(root: ET.Element) -> int:
    """전 악보 — 이음줄(slur) 고아 stop 제거, 중복 start/stop 정리, number 정리, bezier 좌표 제거.

    같은 음에 start/stop이 여러 개면 bezier·default-x/y 없는 쪽을 우선한다.
    (좌표 있는 OMR 곡선을 남기면 OSMD가 끝 음 뒤로 끊긴 꼬리만 그리는 경우가 많음.)

    stop은 **같은 staff + 같은 number**의 open start에만 짝짓는다.
    (다른 number의 open start에 붙이면 OMR 고아 stop이 HITL 긴 이음줄을 가로챔.)

    start number는 가능하면 유지하고, open/used와 충돌할 때만 새 번호를 부여한 뒤
    같은 staff의 짝 stop number도 함께 갱신한다.

    같은 마디에서 stop 직후 number를 재사용하지 않는다. PR/PL 이음줄이 시간상 겹칠 때
    OSMD가 같은 number의 start/stop을 잘못 짝지어 한쪽이 안 보이는 것을 막는다.

    변경된 마디 수 반환.
    """
    ns = _ns(root)
    changed_measures = 0
    layout_attrs = ("bezier-x", "bezier-y", "default-x", "default-y")

    def _slur_layout_noise(s: ET.Element) -> int:
        return sum(1 for a in layout_attrs if s.get(a) is not None)

    def _pick_preferred_slur(slurs: list[ET.Element]) -> ET.Element:
        return min(slurs, key=_slur_layout_noise)

    for part in root.findall(_q(ns, "part")):
        open_slurs: dict[str, dict[str, Any]] = {}

        for measure in part.findall(_q(ns, "measure")):
            mnum = measure.get("number") or ""
            m_changed = False
            used_nums_in_measure: set[str] = set(open_slurs.keys())
            # start를 재번호화했을 때 같은 staff의 짝 stop이 따라오도록
            stop_num_remap: dict[tuple[str, str], str] = {}

            for note in measure.findall(_q(ns, "note")):
                notations = note.find(_q(ns, "notations"))
                if notations is None:
                    continue

                slurs = list(notations.findall(_q(ns, "slur")))
                if not slurs:
                    continue

                staff = note.findtext(_q(ns, "staff")) or "1"
                voice = note.findtext(_q(ns, "voice")) or "1"

                starts = [s for s in slurs if s.get("type") == "start"]
                stops = [s for s in slurs if s.get("type") == "stop"]

                if len(starts) > 1:
                    keep = _pick_preferred_slur(starts)
                    for s in starts:
                        if s is not keep:
                            notations.remove(s)
                            m_changed = True
                    starts = [keep]

                if len(stops) > 1:
                    keep = _pick_preferred_slur(stops)
                    for s in stops:
                        if s is not keep:
                            notations.remove(s)
                            m_changed = True
                    stops = [keep]

                slurs = list(notations.findall(_q(ns, "slur")))

                for s in slurs:
                    for attr in layout_attrs:
                        if s.get(attr) is not None:
                            s.attrib.pop(attr, None)
                            m_changed = True

                starts = [s for s in slurs if s.get("type") == "start"]
                stops = [s for s in slurs if s.get("type") == "stop"]

                for s in stops:
                    orig_num = (s.get("number") or "1").strip() or "1"
                    lookup = stop_num_remap.get((staff, orig_num), orig_num)
                    matched_num = None
                    if lookup in open_slurs and open_slurs[lookup]["staff"] == staff:
                        matched_num = lookup
                    elif orig_num in open_slurs and open_slurs[orig_num]["staff"] == staff:
                        matched_num = orig_num
                    if matched_num is not None:
                        if (s.get("number") or "") != matched_num:
                            s.set("number", matched_num)
                            m_changed = True
                        del open_slurs[matched_num]
                        used_nums_in_measure.add(str(matched_num))
                    else:
                        # 고아 stop — 다른 number의 open start를 가로채지 않음
                        notations.remove(s)
                        m_changed = True

                for s in starts:
                    orig_num = (s.get("number") or "1").strip() or "1"
                    num = orig_num
                    if num in open_slurs or num in used_nums_in_measure:
                        next_num = 1
                        while str(next_num) in open_slurs or str(next_num) in used_nums_in_measure:
                            next_num += 1
                        num = str(next_num)
                    if (s.get("number") or "") != num:
                        s.set("number", num)
                        m_changed = True
                        if orig_num != num:
                            stop_num_remap[(staff, orig_num)] = num
                    open_slurs[num] = {
                        "staff": staff,
                        "voice": voice,
                        "measure_num": mnum,
                    }

                if not list(notations):
                    note.remove(notations)

            if m_changed:
                changed_measures += 1

    return changed_measures


def normalize_dynamics_in_root(root: ET.Element) -> int:
    """전 악보 — note notations에 갇힌 dynamics를 <direction>으로 마이그레이션하고, default-y 여백 부여 및 dynamics -> wedge 시작 순서 보장. 변경된 마디 수 반환."""
    ns = _ns(root)
    changed_measures = 0

    for part in root.findall(_q(ns, "part")):
        for measure in part.findall(_q(ns, "measure")):
            m_changed = False
            # 1. 음표의 notations/dynamics를 <direction>으로 변환
            for note in list(measure.findall(_q(ns, "note"))):
                notations = note.find(_q(ns, "notations"))
                if notations is None:
                    continue
                for dyn in list(notations.findall(_q(ns, "dynamics"))):
                    pl = dyn.get("placement") or "above"
                    staff_n = _note_staff_number(note, ns) or 1
                    dyn_tags = [
                        _local(c)
                        for c in dyn
                        if _local(c) in _DYNAMICS_TAGS
                    ]
                    for dtag in dyn_tags:
                        dir_el = _build_direction_element(
                            ns, "dynamics", dtag, staff_n=staff_n, placement=pl
                        )
                        if pl == "above":
                            dir_el.set("default-y", "25")
                            dt = dir_el.find(_q(ns, "direction-type"))
                            if dt is not None:
                                d_inner = dt.find(_q(ns, "dynamics"))
                                if d_inner is not None:
                                    d_inner.set("default-y", "25")
                        elif pl == "below":
                            dir_el.set("default-y", "-65")
                            dt = dir_el.find(_q(ns, "direction-type"))
                            if dt is not None:
                                d_inner = dt.find(_q(ns, "dynamics"))
                                if d_inner is not None:
                                    d_inner.set("default-y", "-65")
                        idx = list(measure).index(note)
                        measure.insert(idx, dir_el)
                    notations.remove(dyn)
                    if not list(notations):
                        note.remove(notations)
                    m_changed = True

            # 2. 모든 direction dynamics에 default-y 보정 (오선과 너무 가깝게 붙는 현상 방지)
            for d in measure.findall(_q(ns, "direction")):
                pl = d.get("placement") or "below"
                dt = d.find(_q(ns, "direction-type"))
                if dt is None:
                    continue
                dyn = dt.find(_q(ns, "dynamics"))
                if dyn is not None:
                    if pl == "above":
                        if not d.get("default-y"):
                            d.set("default-y", "25")
                            m_changed = True
                        if not dyn.get("default-y"):
                            dyn.set("default-y", "25")
                            m_changed = True
                    elif pl == "below":
                        if not d.get("default-y"):
                            d.set("default-y", "-65")
                            m_changed = True
                        if not dyn.get("default-y"):
                            dyn.set("default-y", "-65")
                            m_changed = True

            # 3. 동일 onset에서 dynamics가 wedge start보다 앞에 오도록 순서 정돈 (p > 순서)
            children = list(measure)
            for i in range(len(children) - 1):
                c1 = children[i]
                c2 = children[i + 1]
                if _local(c1) == "direction" and _local(c2) == "direction":
                    st1 = _direction_effective_staff(measure, c1, ns, 1)
                    st2 = _direction_effective_staff(measure, c2, ns, 1)
                    if st1 == st2:
                        w1 = _wedge_type_of(c1, ns)
                        dyn2 = c2.find(f".//{_q(ns, 'dynamics')}")
                        if w1 in ("crescendo", "diminuendo") and dyn2 is not None:
                            idx1 = list(measure).index(c1)
                            measure.remove(c2)
                            measure.insert(idx1, c2)
                            m_changed = True

            if m_changed:
                changed_measures += 1

    return changed_measures


def normalize_wedges_in_root(root: ET.Element) -> int:
    """전 악보 — 쐐기형 셈여림(crescendo/diminuendo) 순서 역전 보정, 고아 stop 제거, 마디 간 누수 방지, 음표 상단(above) default-y 여백 보정. 변경된 마디 수 반환."""
    ns = _ns(root)
    changed_measures = 0

    for part in root.findall(_q(ns, "part")):
        open_wedges: dict[str, dict[str, Any]] = {}

        for measure in part.findall(_q(ns, "measure")):
            m_changed = False
            mnum = measure.get("number") or ""

            # 수집: 이 마디의 wedge directions
            wedge_dirs: list[tuple[int, ET.Element, str, str, str]] = []  # (idx, dir_el, staff, wtype, number)
            for idx, el in enumerate(list(measure)):
                if _local(el) == "direction":
                    wtype = _wedge_type_of(el, ns)
                    if wtype in ("crescendo", "diminuendo", "stop"):
                        st_n = _direction_effective_staff(measure, el, ns, 1)
                        staff = str(st_n)
                        wel = _wedge_element(el, ns)
                        wnum = (wel.get("number") if wel is not None else None) or "1"
                        pl = el.get("placement") or "below"
                        if pl == "above":
                            if not el.get("default-y"):
                                el.set("default-y", "25")
                                m_changed = True
                            if wel is not None and not wel.get("default-y"):
                                wel.set("default-y", "25")
                                m_changed = True
                        wedge_dirs.append((idx, el, staff, wtype, wnum))

            staves = sorted({wd[2] for wd in wedge_dirs} | set(open_wedges.keys()))
            for st in staves:
                st_wedges = [wd for wd in wedge_dirs if wd[2] == st]
                starts = [wd for wd in st_wedges if wd[3] in ("crescendo", "diminuendo")]
                stops = [wd for wd in st_wedges if wd[3] == "stop"]

                # 1. 마디 내 역전 검사 (start 전에 stop이 먼저 나온 경우)
                if starts and stops and st not in open_wedges:
                    first_stop_idx = next(i for i, wd in enumerate(st_wedges) if wd[3] == "stop")
                    first_start_idx = next(i for i, wd in enumerate(st_wedges) if wd[3] in ("crescendo", "diminuendo"))
                    if first_stop_idx < first_start_idx:
                        stop_dir = st_wedges[first_stop_idx][1]
                        measure.remove(stop_dir)
                        measure.append(stop_dir)
                        m_changed = True
                        st_wedges = [wd for wd in st_wedges if wd[1] != stop_dir]
                        st_wedges.append((len(measure) - 1, stop_dir, st, "stop", st_wedges[0][4] if st_wedges else "1"))
                        starts = [wd for wd in st_wedges if wd[3] in ("crescendo", "diminuendo")]
                        stops = [wd for wd in st_wedges if wd[3] == "stop"]

                # 2. 다중 성부 오선에서 placement=above인 쐐기 셈여림이 보조 성부에 있는 경우 주 성부로 승격
                if (starts or stops) and any(wd[1].get("placement") == "above" for wd in st_wedges):
                    st_n = int(st) if st.isdigit() else 1
                    notes = list_note_elements(measure, ns)
                    st_notes = [n for n in notes if (_note_staff_number(n, ns) or 1) == st_n]
                    if st_notes:
                        voices_on_st: list[str] = []
                        for n in st_notes:
                            v = _note_voice_staff(n, ns)[0]
                            if v not in voices_on_st:
                                voices_on_st.append(v)
                        if len(voices_on_st) > 1:
                            # Primary voice is voices_on_st[0]
                            p_voice = voices_on_st[0]
                            p_notes = [n for n in st_notes if _note_voice_staff(n, ns)[0] == p_voice]
                            if p_notes:
                                for wd in st_wedges:
                                    d_el = wd[1]
                                    if d_el.get("placement") == "above" and d_el in list(measure):
                                        wtype = wd[3]
                                        measure.remove(d_el)
                                        if wtype in ("crescendo", "diminuendo"):
                                            s_idx = list(measure).index(p_notes[0])
                                            measure.insert(s_idx, d_el)
                                        elif wtype == "stop":
                                            e_idx = list(measure).index(p_notes[-1])
                                            measure.insert(e_idx + 1, d_el)
                                        m_changed = True

                # 3. 이전 마디의 미종료 wedge가 있는데 이 마디에서 새 wedge가 시작되는 경우 -> 이전 마디 끝 닫기
                if starts and st in open_wedges:
                    prev_info = open_wedges[st]
                    prev_m = prev_info["measure"]
                    stop_dir = _build_direction_element(
                        ns, "wedge", "stop", staff_n=int(st) if st.isdigit() else 1, placement=prev_info.get("placement") or "below", wedge_number=prev_info.get("number") or "1"
                    )
                    if prev_info.get("placement") == "above":
                        stop_dir.set("default-y", "25")
                        wel = _wedge_element(stop_dir, ns)
                        if wel is not None:
                            wel.set("default-y", "25")
                    bl = prev_m.find(_q(ns, "barline"))
                    if bl is not None:
                        b_idx = list(prev_m).index(bl)
                        prev_m.insert(b_idx, stop_dir)
                    else:
                        prev_m.append(stop_dir)
                    changed_measures += 1
                    del open_wedges[st]

                # 4. 고아 stop 제거 (열린 wedge가 없는데 단독 stop만 있는 경우)
                if stops and not starts and st not in open_wedges:
                    for wd in stops:
                        if wd[1] in list(measure):
                            measure.remove(wd[1])
                            m_changed = True
                    stops = []

                # 5. open_wedges 상태 갱신
                if starts and not stops:
                    open_wedges[st] = {
                        "measure": measure,
                        "wedge_dir": starts[-1][1],
                        "type": starts[-1][3],
                        "number": starts[-1][4],
                        "placement": starts[-1][1].get("placement") or "below",
                    }
                elif stops and not starts:
                    open_wedges.pop(st, None)
                elif starts and stops:
                    last_w = st_wedges[-1]
                    if last_w[3] in ("crescendo", "diminuendo"):
                        open_wedges[st] = {
                            "measure": measure,
                            "wedge_dir": last_w[1],
                            "type": last_w[3],
                            "number": last_w[4],
                            "placement": last_w[1].get("placement") or "below",
                        }
                    else:
                        open_wedges.pop(st, None)

            if m_changed:
                changed_measures += 1

    return changed_measures


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
    timed_starts = dict(_staff_timed_leader_starts(measure, ns, staff))
    leaders: list[tuple[int, str, int, int]] = []
    leader_indices: list[int] = []
    for i, note in enumerate(notes):
        if _is_grace_or_cue(note, ns) or note.find(_q(ns, "chord")) is not None:
            continue
        voice, st = _note_voice_staff(note, ns)
        if st != staff:
            continue
        leader_indices.append(i)
        start = timed_starts.get(i, 0)
        dur = _note_duration(note, ns)
        leaders.append((i, voice, start, start + dur))
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
    # Audiveris 절대 default-y가 남으면 OSMD 빔이 앞·위 오선 쪽으로 깨짐
    stem_el.attrib.pop("default-y", None)
    stem_el.attrib.pop("default-x", None)


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

    has_grace = [notes[i].find(_q(ns, "grace")) is not None for i in pitched]
    if any(has_grace):
        if not all(has_grace):
            return False
        _apply_grace_beams([notes[i] for i in pitched], ns)
        return True

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
        _strip_beams_from_note(notes[idx], ns, None)
        for fidx in _chord_follower_indices(notes, ns, idx):
            _strip_beams_from_note(notes[fidx], ns, None)

    for pos, idx in enumerate(pitched):
        if pos == 0:
            val = "begin"
        elif pos == len(pitched) - 1:
            val = "end"
        else:
            val = "continue"
        _set_beam_on_note(notes[idx], ns, beam_number, val)
    for idx in pitched:
        stem_el = notes[idx].find(_q(ns, "stem"))
        if stem_el is not None:
            stem_el.attrib.pop("default-y", None)
            stem_el.attrib.pop("default-x", None)
        for fidx in _chord_follower_indices(notes, ns, idx):
            fst = notes[fidx].find(_q(ns, "stem"))
            if fst is not None:
                fst.attrib.pop("default-y", None)
                fst.attrib.pop("default-x", None)
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
            label = _NAVIGATION_DIRECTION_LABELS.get(loc, loc)
            # To Coda / D.S. + 기호 — 텍스트 라벨만 (기호는 OSMD·MusicXML 기호 태그)
            if loc == "coda" and any("To Coda" in p or p == "Coda" for p in parts):
                continue
            if loc == "segno" and any(p.startswith("D.S") for p in parts):
                continue
            if label not in parts:
                parts.append(label)
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
    direction: ET.Element, ns: str, note: ET.Element | None, *, replace: bool = False
) -> None:
    if note is None:
        return
    voice_n = _note_voice_number(note, ns)
    if voice_n is None:
        return
    existing = direction.find(_q(ns, "voice"))
    if existing is not None:
        if replace:
            existing.text = str(voice_n)
        return
    ET.SubElement(direction, _q(ns, "voice")).text = str(voice_n)


def _copy_layout_from_note_to_direction(direction: ET.Element, note: ET.Element) -> None:
    for attr in ("default-x", "default-y"):
        val = note.get(attr)
        if val:
            direction.set(attr, val)


def _bind_direction_voice_from_staff(
    measure: ET.Element, ns: str, direction: ET.Element, staff_n: int
) -> None:
    """PL 등 staff≥2 direction — OSMD 미리보기·MuseScore voice 연결.

    backup을 넘어 다음 성부 음을 보지 않는다. wedge(stop)은 직전 음을 우선한다.
    wedge는 기존 voice가 있어도 인접 음에 다시 맞춘다.
    """
    wtype = _wedge_type_of(direction, ns)
    is_wedge = wtype in ("crescendo", "diminuendo", "stop")
    if staff_n < 2 and not is_wedge:
        return
    if direction.find(_q(ns, "voice")) is not None and not is_wedge:
        return
    children = list(measure)
    try:
        idx = children.index(direction)
    except ValueError:
        return
    prefer_prev = wtype == "stop"

    def _try_attach_from(note: ET.Element) -> bool:
        if (_note_staff_number(note, ns) or 1) != staff_n:
            return False
        _attach_voice_to_direction_from_note(direction, ns, note, replace=is_wedge)
        return True

    if prefer_prev:
        for j in range(idx - 1, -1, -1):
            prv = children[j]
            if _local(prv) == "backup":
                break
            if _local(prv) == "note" and prv.find(_q(ns, "chord")) is None:
                if _try_attach_from(prv):
                    return
    for j in range(idx + 1, len(children)):
        nxt = children[j]
        if _local(nxt) == "backup":
            break
        if _local(nxt) == "note" and nxt.find(_q(ns, "chord")) is None:
            if _try_attach_from(nxt):
                return
    if not prefer_prev:
        for j in range(idx - 1, -1, -1):
            prv = children[j]
            if _local(prv) == "backup":
                break
            if _local(prv) == "note" and prv.find(_q(ns, "chord")) is None:
                if _try_attach_from(prv):
                    return


def _wedge_type_of(direction: ET.Element, ns: str) -> str | None:
    for dtype in direction.findall(_q(ns, "direction-type")):
        wedge = dtype.find(_q(ns, "wedge"))
        if wedge is None:
            continue
        t = (wedge.get("type") or "").strip().lower()
        if t:
            return t
    return None


def _build_direction_element(
    ns: str,
    direction_type: str,
    value: str,
    *,
    staff_n: int | None = None,
    voice_n: int | None = None,
    placement: str | None = None,
    wedge_spread: str | None = None,
    wedge_number: str | None = None,
) -> ET.Element:
    direction = ET.Element(_q(ns, "direction"))
    if placement in ("above", "below"):
        direction.set("placement", placement)
        direction.set("default-y", "45" if placement == "above" else "-65")
    kind = (direction_type or "words").strip().lower()
    val = str(value or "").strip()
    if kind == "dynamics":
        dtype = ET.SubElement(direction, _q(ns, "direction-type"))
        tag = val.lower() or "p"
        if tag not in _DYNAMICS_TAGS:
            tag = "p"
        dyn = ET.SubElement(dtype, _q(ns, "dynamics"))
        if placement in ("above", "below"):
            dyn.set("placement", placement)
            dyn.set("default-y", "45" if placement == "above" else "-65")
        ET.SubElement(dyn, _q(ns, tag))
    elif kind == "rehearsal":
        dtype = ET.SubElement(direction, _q(ns, "direction-type"))
        el = ET.SubElement(dtype, _q(ns, "rehearsal"))
        el.text = val or "A"
    elif kind == "segno":
        dtype = ET.SubElement(direction, _q(ns, "direction-type"))
        ET.SubElement(dtype, _q(ns, "segno"))
    elif kind == "coda":
        # MusicXML 표준: 마커는 <coda/> 만
        dtype = ET.SubElement(direction, _q(ns, "direction-type"))
        ET.SubElement(dtype, _q(ns, "coda"))
    elif kind == "tocoda":
        # MusicXML 표준: 점프는 words + sound@tocoda (Coda 기호를 함께 넣으면 루프 오류 발생)
        dtype = ET.SubElement(direction, _q(ns, "direction-type"))
        words = ET.SubElement(dtype, _q(ns, "words"))
        words.text = "To Coda"
        sound = ET.SubElement(direction, _q(ns, "sound"))
        sound.set("tocoda", "coda")
    elif kind == "fine":
        dtype = ET.SubElement(direction, _q(ns, "direction-type"))
        words = ET.SubElement(dtype, _q(ns, "words"))
        words.text = "Fine"
        sound = ET.SubElement(direction, _q(ns, "sound"))
        sound.set("fine", "yes")
    elif kind == "dacapo":
        dtype = ET.SubElement(direction, _q(ns, "direction-type"))
        words = ET.SubElement(dtype, _q(ns, "words"))
        words.text = "D.C."
        sound = ET.SubElement(direction, _q(ns, "sound"))
        sound.set("dacapo", "yes")
    elif kind == "dalsegno":
        # MusicXML: words + sound@dalsegno (Segno 기호를 함께 넣으면 Musescore 4 재생 시 루프 오류 발생)
        dtype = ET.SubElement(direction, _q(ns, "direction-type"))
        words = ET.SubElement(dtype, _q(ns, "words"))
        words.text = "D.S."
        sound = ET.SubElement(direction, _q(ns, "sound"))
        sound.set("dalsegno", "segno")
    elif kind == "wedge":
        wtype = val.lower() if val.lower() in _WEDGE_TYPES else "crescendo"
        dtype = ET.SubElement(direction, _q(ns, "direction-type"))
        w = ET.SubElement(dtype, _q(ns, "wedge"))
        w.set("type", wtype)
        if placement in ("above", "below"):
            w.set("default-y", "45" if placement == "above" else "-65")
        if wedge_number:
            w.set("number", str(wedge_number))
        spread = (wedge_spread or "").strip()
        if not spread:
            if wtype == "crescendo":
                spread = "0"
            elif wtype == "diminuendo":
                spread = "15"
            elif wtype == "stop":
                spread = "15"
        if spread:
            w.set("spread", spread)
    elif kind in _NAVIGATION_DIRECTION_TAGS:
        # 하위 호환 — 알 수 없는 nav 태그는 words로
        dtype = ET.SubElement(direction, _q(ns, "direction-type"))
        words = ET.SubElement(dtype, _q(ns, "words"))
        words.text = _NAVIGATION_DIRECTION_LABELS.get(kind, val or kind)
    else:
        dtype = ET.SubElement(direction, _q(ns, "direction-type"))
        el = ET.SubElement(dtype, _q(ns, "words"))
        el.text = val or " "
    if voice_n is not None:
        ET.SubElement(direction, _q(ns, "voice")).text = str(voice_n)
    if staff_n is not None:
        staff_el = ET.SubElement(direction, _q(ns, "staff"))
        staff_el.text = str(staff_n)
    return direction


def _insert_after_note_group(
    measure: ET.Element,
    ns: str,
    new_el: ET.Element,
    after_note_index: int,
) -> None:
    """after_note_index 음표와 뒤따르는 <chord/> 바로 뒤 — wedge stop이 그 음까지 덮이게."""
    notes = [c for c in list(measure) if _local(c) == "note"]
    if after_note_index < 0 or after_note_index >= len(notes):
        _insert_direction_at_measure_end(measure, ns, new_el)
        return
    end_i = _chord_group_end_index(notes, ns, after_note_index)
    end_note = notes[end_i]
    children = list(measure)
    try:
        idx = children.index(end_note)
    except ValueError:
        _insert_direction_at_measure_end(measure, ns, new_el)
        return
    measure.insert(idx + 1, new_el)


def _last_rhythmic_note_index_on_staff(notes: list[ET.Element], ns: str, staff_n: int) -> int:
    last = -1
    for i, note in enumerate(notes):
        if note.find(_q(ns, "chord")) is not None:
            continue
        if (_note_staff_number(note, ns) or 1) != staff_n:
            continue
        last = i
    return last


def _wedge_element(direction: ET.Element, ns: str) -> ET.Element | None:
    for dtype in direction.findall(_q(ns, "direction-type")):
        wedge = dtype.find(_q(ns, "wedge"))
        if wedge is not None:
            return wedge
    return None


def _next_wedge_number(measure: ET.Element, ns: str) -> str:
    used: set[int] = set()
    for direction in measure.findall(_q(ns, "direction")):
        wedge = _wedge_element(direction, ns)
        if wedge is None:
            continue
        raw = (wedge.get("number") or "1").strip()
        if raw.isdigit():
            used.add(int(raw))
    n = 1
    while n in used:
        n += 1
    return str(n)


def _open_wedge_number_on_staff(measure: ET.Element, ns: str, staff_n: int) -> str | None:
    last_num: str | None = None
    for direction in measure.findall(_q(ns, "direction")):
        if (_direction_staff_number(direction, ns) or 1) != staff_n:
            continue
        wtype = _wedge_type_of(direction, ns)
        if wtype in ("crescendo", "diminuendo"):
            wedge = _wedge_element(direction, ns)
            last_num = (wedge.get("number") if wedge is not None else None) or "1"
        elif wtype == "stop":
            last_num = None
    return last_num


def _insert_standalone_wedge(
    measure: ET.Element,
    ns: str,
    notes: list[ET.Element],
    *,
    wtype: str,
    staff_n: int,
    placement: str | None,
    before_note_index: int | None = None,
    after_note_index: int | None = None,
    wedge_spread: str | None = None,
    wedge_number: str | None = None,
) -> ET.Element:
    """마디 `<direction><wedge>` — 시작은 음 앞, stop은 음(화음) 뒤(마디 끝 barline은 OSMD가 다음 마디로 넘김)."""
    if placement not in ("above", "below"):
        placement = "below"
    new_dir = _build_direction_element(
        ns,
        "wedge",
        wtype,
        staff_n=staff_n,
        placement=placement,
        wedge_spread=wedge_spread,
        wedge_number=wedge_number,
    )
    if after_note_index is not None:
        _insert_after_note_group(measure, ns, new_dir, after_note_index)
    elif before_note_index is None or before_note_index < 0:
        _insert_direction_at_staff_measure_start(measure, ns, new_dir, staff_n)
    elif before_note_index >= len(notes):
        last_i = _last_rhythmic_note_index_on_staff(notes, ns, staff_n)
        if last_i >= 0:
            _insert_after_note_group(measure, ns, new_dir, last_i)
        else:
            _insert_direction_at_measure_end(measure, ns, new_dir)
    else:
        _insert_before_note_element(measure, ns, new_dir, before_note_index, staff_n=staff_n)
    _bind_direction_voice_from_staff(measure, ns, new_dir, staff_n)
    return new_dir


def _remove_wedge_stops_on_staff(measure: ET.Element, ns: str, staff_n: int) -> int:
    removed = 0
    for direction in list(measure.findall(_q(ns, "direction"))):
        if _wedge_type_of(direction, ns) != "stop":
            continue
        if (_direction_staff_number(direction, ns) or 1) != staff_n:
            continue
        measure.remove(direction)
        removed += 1
    return removed


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


def _filter_elements_for_split(elements: list[ET.Element], ns: str, voice_layer: int = 0) -> list[ET.Element]:
    res = []
    i = 0
    while i < len(elements):
        el = elements[i]
        tag = _local(el)
        if tag == "direction":
            res.append(copy.deepcopy(el))
            i += 1
            continue
        if tag == "note":
            chord_group = [el]
            j = i + 1
            while j < len(elements) and _local(elements[j]) == "note" and elements[j].find(_q(ns, "chord")) is not None:
                chord_group.append(elements[j])
                j += 1
            i = j
            if len(chord_group) >= 2:
                if voice_layer == 0:
                    picked = copy.deepcopy(chord_group[0])
                    v_el = picked.find(_q(ns, "voice"))
                    if v_el is not None:
                        v_el.text = "1"
                    res.append(picked)
                else:
                    picked = copy.deepcopy(chord_group[-1])
                    chord_tag = picked.find(_q(ns, "chord"))
                    if chord_tag is not None:
                        picked.remove(chord_tag)
                    v_el = picked.find(_q(ns, "voice"))
                    if v_el is not None:
                        v_el.text = "1"
                    res.append(picked)
            else:
                single = copy.deepcopy(chord_group[0])
                v_el = single.find(_q(ns, "voice"))
                v_text = v_el.text.strip() if v_el is not None and v_el.text else "1"
                if voice_layer == 0:
                    if v_text in ("1", ""):
                        res.append(single)
                elif voice_layer == 1:
                    if v_text == "2":
                        if v_el is not None:
                            v_el.text = "1"
                        res.append(single)
                    elif v_text in ("1", ""):
                        res.append(single)
            continue
        if tag in ("backup", "forward"):
            pass
        i += 1
    return res


def _apply_set_measure_clef(root: ET.Element, ns: str, fix: dict[str, Any]) -> bool:
    part_id = str(fix.get("partId") or "").strip()
    measure_spec = str(fix.get("measureMxl") or "").strip()
    clef_sign = str(fix.get("clefSign") or "G").strip().upper()
    clef_line = int(fix.get("clefLine") or (2 if clef_sign == "G" else 4))
    staff_n = int(fix.get("staff") or 1)
    remove_subsequent = bool(fix.get("removeSubsequentClefs", True))

    part = find_part(root, ns, part_id)
    if part is None or not measure_spec:
        return False

    measures = part.findall(_q(ns, "measure"))
    if not measures:
        return False

    if "-" in measure_spec:
        parts = measure_spec.split("-", 1)
        try:
            start_n = int(parts[0].strip())
            end_n = int(parts[1].strip())
            target_measures = [
                m for m in measures
                if m.get("number") and m.get("number").isdigit() and start_n <= int(m.get("number")) <= end_n
            ]
        except ValueError:
            target_measures = [m for m in measures if m.get("number") == measure_spec]
    else:
        target_measures = [m for m in measures if m.get("number") == measure_spec]

    if not target_measures:
        return False

    first_target = target_measures[0]
    attrs = first_target.find(_q(ns, "attributes"))
    if attrs is None:
        attrs = ET.Element(_q(ns, "attributes"))
        first_target.insert(0, attrs)

    found_clef = None
    for c in attrs.findall(_q(ns, "clef")):
        c_staff = c.get("number")
        if c_staff is None or c_staff == str(staff_n) or staff_n == 1:
            found_clef = c
            break
    if found_clef is None:
        found_clef = ET.SubElement(attrs, _q(ns, "clef"))
        if staff_n > 1 or len(attrs.findall(_q(ns, "clef"))) > 1:
            found_clef.set("number", str(staff_n))

    s_el = found_clef.find(_q(ns, "sign"))
    if s_el is None:
        s_el = ET.SubElement(found_clef, _q(ns, "sign"))
    s_el.text = clef_sign

    l_el = found_clef.find(_q(ns, "line"))
    if l_el is None:
        l_el = ET.SubElement(found_clef, _q(ns, "line"))
    l_el.text = str(clef_line)

    if remove_subsequent and len(target_measures) > 1:
        for m in target_measures[1:]:
            m_attrs = m.find(_q(ns, "attributes"))
            if m_attrs is not None:
                for c in list(m_attrs.findall(_q(ns, "clef"))):
                    c_staff = c.get("number")
                    if c_staff is None or c_staff == str(staff_n) or staff_n == 1:
                        m_attrs.remove(c)
                if len(list(m_attrs)) == 0:
                    m.remove(m_attrs)

    return True


def _apply_copy_measure_content(root: ET.Element, ns: str, fix: dict[str, Any]) -> bool:
    from_part_id = str(fix.get("fromPartId") or fix.get("partId") or "").strip()
    to_part_ids = list(fix.get("toPartIds") or ([fix["toPartId"]] if fix.get("toPartId") else []))
    to_part_ids = [str(p).strip() for p in to_part_ids if str(p).strip()]
    measure_spec = str(fix.get("measureMxl") or "").strip()
    if not from_part_id or not to_part_ids or not measure_spec:
        return False

    from_part = find_part(root, ns, from_part_id)
    if from_part is None:
        return False

    measures = from_part.findall(_q(ns, "measure"))
    if "-" in measure_spec:
        parts = measure_spec.split("-", 1)
        try:
            start_n = int(parts[0].strip())
            end_n = int(parts[1].strip())
            m_nums = [
                m.get("number") for m in measures
                if m.get("number") and m.get("number").isdigit() and start_n <= int(m.get("number")) <= end_n
            ]
        except ValueError:
            m_nums = [measure_spec]
    else:
        m_nums = [measure_spec]

    if not m_nums:
        return False

    clear_source = bool(fix.get("clearSource", False))
    split_voices = bool(fix.get("splitVoices", True))

    any_applied = False
    for m_num in m_nums:
        src_m = find_measure(from_part, ns, m_num)
        if src_m is None:
            continue

        is_split_eligible = split_voices and len(to_part_ids) >= 2
        music_tags = {"note", "backup", "forward", "direction"}
        src_music_elements = [copy.deepcopy(c) for c in src_m if _local(c) in music_tags]
        if not src_music_elements:
            continue

        src_notes = list_note_elements(src_m, ns)
        measure_dur = 0
        for n in src_notes:
            if n.find(_q(ns, "chord")) is None:
                d = n.find(_q(ns, "duration"))
                if d is not None and d.text and d.text.strip().isdigit():
                    measure_dur += int(d.text.strip())

        for idx, to_pid in enumerate(to_part_ids):
            to_part = find_part(root, ns, to_pid)
            if to_part is None:
                continue
            dst_m = find_measure(to_part, ns, m_num)
            if dst_m is None:
                continue

            cloned = [copy.deepcopy(c) for c in src_music_elements]
            if is_split_eligible:
                cloned = _filter_elements_for_split(cloned, ns, voice_layer=idx)

            for el in cloned:
                st = el.find(_q(ns, "staff"))
                if st is not None:
                    st.text = "1"

            for c in list(dst_m):
                if _local(c) in music_tags:
                    dst_m.remove(c)

            barline = dst_m.find(_q(ns, "barline"))
            if barline is not None:
                b_idx = list(dst_m).index(barline)
                for el in cloned:
                    dst_m.insert(b_idx, el)
                    b_idx += 1
            else:
                for el in cloned:
                    dst_m.append(el)

            rebuild_measure_timeline_clean(dst_m, ns, to_part)
            any_applied = True

        if clear_source:
            for c in list(src_m):
                if _local(c) in music_tags:
                    src_m.remove(c)
            rest_note = ET.Element(_q(ns, "note"))
            ET.SubElement(rest_note, _q(ns, "rest"), {"measure": "yes"})
            if measure_dur > 0:
                ET.SubElement(rest_note, _q(ns, "duration")).text = str(measure_dur)
            ET.SubElement(rest_note, _q(ns, "voice")).text = "1"
            ET.SubElement(rest_note, _q(ns, "type")).text = "whole"
            ET.SubElement(rest_note, _q(ns, "staff")).text = "1"

            barline = src_m.find(_q(ns, "barline"))
            if barline is not None:
                b_idx = list(src_m).index(barline)
                src_m.insert(b_idx, rest_note)
            else:
                src_m.append(rest_note)
            rebuild_measure_timeline_clean(src_m, ns, from_part)

    return any_applied


def apply_fix(root: ET.Element, ns: str, fix: dict[str, Any]) -> bool:
    kind = fix.get("kind")
    part_id = str(fix.get("partId") or "").strip()
    measure_mxl = str(fix.get("measureMxl") or "").strip()
    if not part_id or not measure_mxl:
        return False

    if kind in ("copyMeasureContent", "copyMeasurePart"):
        return _apply_copy_measure_content(root, ns, fix)

    if kind in ("setMeasureClef", "setPartClef"):
        return _apply_set_measure_clef(root, ns, fix)

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

    if kind == "setNoteVoice":
        try:
            idx = int(fix.get("noteIndex"))
            voice_val = str(fix.get("voice") or "1").strip()
        except (TypeError, ValueError):
            return False
        if idx < 0 or idx >= len(notes):
            return False
        note = notes[idx]
        group_indices = [idx]
        if note.find(_q(ns, "chord")) is None:
            group_indices.extend(_chord_follower_indices(notes, ns, idx))
        else:
            leader_i = _chord_leader_index(notes, ns, idx)
            group_indices = [leader_i, *_chord_follower_indices(notes, ns, leader_i)]
        for gi in group_indices:
            n = notes[gi]
            v_el = n.find(_q(ns, "voice"))
            if v_el is None:
                v_el = ET.SubElement(n, _q(ns, "voice"))
            v_el.text = voice_val
            _sort_note_children(n, ns)
        _normalize_measure_note_engraving(part, ns, measure)
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
        if not (0 <= idx < len(notes)):
            return False
        note = notes[idx]
        is_member = note.find(_q(ns, "chord")) is not None
        if not is_member:
            followers = [notes[j] for j in _chord_follower_indices(notes, ns, idx)]
            measure.remove(note)
            if followers:
                chord_el = followers[0].find(_q(ns, "chord"))
                if chord_el is not None:
                    followers[0].remove(chord_el)
                    _sort_note_children(followers[0], ns)
        else:
            measure.remove(note)
        _normalize_measure_note_engraving(part, ns, measure)
        return True

    if kind == "removeArticulation":
        try:
            idx = int(fix.get("noteIndex"))
        except (TypeError, ValueError):
            return False
        if idx < 0 or idx >= len(notes):
            return False
        note = notes[idx]
        # articulation 이름이 주어지면 그것만, 없으면 articulations 전부 제거
        raw_target = str(fix.get("articulation") or "").strip().lower().split("(")[0].replace("_", "-")
        target = raw_target or None
        removed = False
        for notations in list(note.findall(_q(ns, "notations"))):
            for arts in list(notations.findall(_q(ns, "articulations"))):
                for art in list(arts):
                    art_name = _local(art).lower().replace("_", "-")
                    if target is None or art_name == target:
                        arts.remove(art)
                        removed = True
                if len(arts) == 0:
                    notations.remove(arts)
            if len(notations) == 0:
                note.remove(notations)
        return removed

    if kind == "removeOrnament":
        try:
            idx = int(fix.get("noteIndex"))
        except (TypeError, ValueError):
            return False
        if idx < 0 or idx >= len(notes):
            return False
        note = notes[idx]
        raw = str(fix.get("ornament") or "").strip()
        target = raw.split("(")[0] or None
        target_type = None
        if target and ":" in target:
            target, target_type = target.split(":", 1)
            target = target.strip() or None
            target_type = target_type.strip() or None
        removed = False
        for notations in list(note.findall(_q(ns, "notations"))):
            for orns in list(notations.findall(_q(ns, "ornaments"))):
                for orn in list(orns):
                    name = _local(orn)
                    extra = (orn.get("type") or "").strip()
                    if target is None or (
                        name == target and (target_type is None or extra == target_type)
                    ):
                        orns.remove(orn)
                        removed = True
                if len(orns) == 0:
                    notations.remove(orns)
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
        if not (0 <= direction_index < len(directions)):
            return False
        target = directions[direction_index]
        wtype = _wedge_type_of(target, ns)
        staff_n = _direction_staff_number(target, ns) or 1
        wedge_el = _wedge_element(target, ns)
        wedge_no = (wedge_el.get("number") if wedge_el is not None else None) or "1"
        measure.remove(target)
        # 같은 staff·number의 wedge 짝(start↔stop)도 함께 제거 — PR/PL 독립 삭제
        if wtype in ("crescendo", "diminuendo", "stop"):
            for other in list(measure.findall(_q(ns, "direction"))):
                if (_direction_staff_number(other, ns) or 1) != staff_n:
                    continue
                ow = _wedge_element(other, ns)
                if ow is None:
                    continue
                if (ow.get("number") or "1") != wedge_no:
                    continue
                ot = _wedge_type_of(other, ns)
                if wtype == "stop" and ot in ("crescendo", "diminuendo"):
                    measure.remove(other)
                elif wtype in ("crescendo", "diminuendo") and ot == "stop":
                    measure.remove(other)
        return True

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

    if kind == "setDirectionPlacement":
        placement = str(fix.get("placement") or "").strip().lower()
        if placement not in ("above", "below"):
            return False
        dist_raw = fix.get("distance")
        dist = None if dist_raw in (None, "", "auto") else str(dist_raw).strip().lower()
        try:
            direction_index = int(fix.get("directionIndex"))
        except (TypeError, ValueError):
            return False
        directions = measure.findall(_q(ns, "direction"))
        if not (0 <= direction_index < len(directions)):
            return False
        direction = directions[direction_index]
        direction.set("placement", placement)
        dy = _calc_direction_default_y(placement, dist)
        direction.set("default-y", str(dy))
        _set_direction_distance_on_el(direction, dist)
        dtype = direction.find(_q(ns, "direction-type"))
        if dtype is not None:
            for child in dtype:
                child.set("placement", placement)
                child.set("default-y", str(dy))
        return True

    if kind == "setNoteDirectionPlacement":
        placement = str(fix.get("placement") or "").strip().lower()
        if placement not in ("above", "below"):
            return False
        dist_raw = fix.get("distance")
        dist = None if dist_raw in (None, "", "auto") else str(dist_raw).strip().lower()
        dy = _calc_direction_default_y(placement, dist)
        try:
            note_idx = int(fix.get("noteIndex"))
        except (TypeError, ValueError):
            return False
        if note_idx < 0 or note_idx >= len(notes):
            return False
        note = notes[note_idx]
        direction_type = str(fix.get("directionType") or "words").strip().lower()
        direction_value = str(fix.get("directionValue") or "").strip()
        changed = False
        if direction_type == "dynamics":
            for notations in note.findall(_q(ns, "notations")):
                for dyn in notations.findall(_q(ns, "dynamics")):
                    dyn.set("placement", placement)
                    dyn.set("default-y", str(dy))
                    _set_direction_distance_on_el(dyn, dist)
                    changed = True
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
                    if direction_type == "dynamics" and dtype.find(_q(ns, "dynamics")) is not None:
                        c.set("placement", placement)
                        c.set("default-y", str(dy))
                        _set_direction_distance_on_el(c, dist)
                        dyn = dtype.find(_q(ns, "dynamics"))
                        if dyn is not None:
                            dyn.set("placement", placement)
                            dyn.set("default-y", str(dy))
                            _set_direction_distance_on_el(dyn, dist)
                        changed = True
                    else:
                        mark = dtype.find(_q(ns, direction_type))
                        if mark is not None and (not direction_value or (mark.text or "").strip() == direction_value):
                            c.set("placement", placement)
                            c.set("default-y", str(dy))
                            _set_direction_distance_on_el(c, dist)
                            mark.set("default-y", str(dy))
                            changed = True
            if _local(c) == "note":
                break
        return changed

    if kind == "clearNoteDirection":
        try:
            note_idx = int(fix.get("noteIndex"))
        except (TypeError, ValueError):
            return False
        return _clear_note_direction(measure, notes, note_idx, ns)

    if kind in ("setNoteDirection", "addNoteDirection"):
        direction_type = str(fix.get("directionType") or "words").strip().lower()
        direction_value = str(fix.get("directionValue") or fix.get("detail") or "").strip()
        dist_raw = fix.get("distance")
        dist = None if dist_raw in (None, "", "auto") else str(dist_raw).strip().lower()
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
            measure, notes, note_idx, ns, direction_type, direction_value, placement, distance=dist
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
        measure_anchor = str(fix.get("measureAnchor") or "").strip().lower()
        if measure_anchor == "start":
            after_idx = -1
        elif measure_anchor == "end":
            last_i = -1
            for i, note in enumerate(notes):
                if note.find(_q(ns, "chord")) is not None:
                    continue
                if (_note_staff_number(note, ns) or 1) != staff_n:
                    continue
                last_i = i
            after_idx = last_i if last_i >= 0 else -1
        placement = str(fix.get("placement") or "").strip().lower() or None
        if placement not in ("above", "below", ""):
            placement = None
        if direction_type == "wedge":
            wtype = direction_value.lower() if direction_value.lower() in _WEDGE_TYPES else "crescendo"
            if placement is None:
                placement = "below"
            before_idx = fix.get("beforeNoteIndex")
            if before_idx is None:
                before_idx = after_idx if after_idx >= 0 else None
            else:
                try:
                    before_idx = int(before_idx)
                except (TypeError, ValueError):
                    before_idx = None
            if measure_anchor == "end":
                before_idx = len(notes)
            elif measure_anchor == "start":
                before_idx = -1
            if wtype == "stop":
                end_i = before_idx if before_idx is not None and 0 <= before_idx < len(notes) else _last_rhythmic_note_index_on_staff(
                    notes, ns, staff_n
                )
                _insert_standalone_wedge(
                    measure,
                    ns,
                    notes,
                    wtype="stop",
                    staff_n=staff_n,
                    placement=placement,
                    after_note_index=end_i if end_i >= 0 else None,
                )
            else:
                _insert_standalone_wedge(
                    measure,
                    ns,
                    notes,
                    wtype=wtype,
                    staff_n=staff_n,
                    placement=placement,
                    before_note_index=before_idx,
                )
            return True
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
            # 마디 끝은 barline 직전 — 마지막 음 직후(backup 앞)에 넣으면 다음 마디 앞으로 보임
            if measure_anchor == "end":
                _insert_direction_at_measure_end(measure, ns, new_dir)
            elif after_idx < 0 or measure_anchor == "start":
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
        raw_grace_notes = fix.get("graceNotes")
        if isinstance(raw_grace_notes, list) and len(raw_grace_notes) > 0:
            grace_list = raw_grace_notes
        else:
            step = str(fix.get("pitchStep") or "").strip()
            if not step:
                return False
            try:
                octave = int(fix.get("pitchOctave"))
            except (TypeError, ValueError):
                return False
            alter = fix.get("pitchAlter")
            alter_n: int | None = None
            if alter is not None and alter != "":
                try:
                    alter_n = int(alter)
                except (TypeError, ValueError):
                    alter_n = None
            note_type = str(fix.get("noteType") or "eighth").strip()
            slash = fix.get("graceSlash")
            slash_b = True if slash is None else bool(slash)
            grace_list = [
                {
                    "pitchStep": step,
                    "pitchOctave": octave,
                    "pitchAlter": alter_n,
                    "noteType": note_type,
                    "graceSlash": slash_b,
                }
            ]

        try:
            before_idx = int(fix.get("beforeNoteIndex", fix.get("noteIndex", -1)))
        except (TypeError, ValueError):
            return False
        if before_idx < 0 or before_idx >= len(notes):
            return False

        before_idx = _chord_leader_index(notes, ns, before_idx)
        target_note = notes[before_idx]
        if target_note.find(_q(ns, "rest")) is not None:
            return False

        staff_n = _note_staff_number(target_note, ns) or int(fix.get("staff") or 1)
        voice, stem = _infer_voice_stem_from_neighbors(notes, ns, before_idx, staff_n)
        beam_grace = bool(fix.get("beamGraceNotes", fix.get("beam", len(grace_list) >= 2)))

        insert_after_idx = before_idx - 1
        if insert_after_idx >= 0 and target_note.find(_q(ns, "grace")) is None:
            insert_after_idx, staff_n, _, _, _ = _resolve_insert_after_context(
                notes, ns, insert_after_idx, staff_n
            )

        target_po = _read_play_order(target_note)
        has_staff_po = any(
            _read_play_order(n) is not None
            for n in notes
            if (_note_staff_number(n, ns) or 1) == staff_n
        )

        insert_po: int | None = None
        if target_po is not None or has_staff_po:
            if target_po is not None:
                insert_po = target_po
            else:
                defaults = _default_play_orders_for_staff(measure, ns, str(staff_n))
                insert_po = defaults.get(before_idx, 1)

            shift_count = len(grace_list)
            for n in notes:
                if n.find(_q(ns, "chord")) is not None:
                    continue
                if (_note_staff_number(n, ns) or 1) != staff_n:
                    continue
                cur_po = _read_play_order(n)
                if cur_po is not None and cur_po >= insert_po:
                    _set_play_order_on_leader(notes, ns, notes.index(n), cur_po + shift_count)

        created_notes: list[ET.Element] = []
        fx = _parse_default_x(target_note) or 50.0
        total_k = len(grace_list)
        group_stem = stem if stem in ("up", "down") else "up"

        for k, g_spec in enumerate(grace_list):
            g_step = str(g_spec.get("pitchStep") or "C").strip().upper()
            try:
                g_oct = int(g_spec.get("pitchOctave") or 4)
            except (TypeError, ValueError):
                g_oct = 4
            g_alt = g_spec.get("pitchAlter")
            g_alt_n = int(g_alt) if g_alt is not None and g_alt != "" else None
            g_type = str(g_spec.get("noteType") or "eighth").strip()
            if g_type not in ("eighth", "16th", "32nd", "64th"):
                g_type = "eighth"
            g_slash = g_spec.get("graceSlash")
            if g_slash is None:
                g_slash_b = False if (beam_grace and total_k >= 2) else True
            else:
                g_slash_b = bool(g_slash)

            new_note = _build_grace_note(
                ns,
                step=g_step,
                octave=g_oct,
                alter=g_alt_n,
                note_type=g_type,
                staff_n=staff_n,
                voice=voice,
                stem=group_stem,
                slash=g_slash_b,
            )

            x_offset = (total_k - k) * 12.0
            new_note.set("default-x", f"{max(fx - x_offset, 1.0):.2f}")

            if insert_po is not None:
                new_note.set(PLAY_ORDER_ATTR, str(insert_po + k))

            created_notes.append(new_note)

        if beam_grace and len(created_notes) >= 2:
            _apply_grace_beams(created_notes, ns)

        if insert_after_idx < 0:
            target_pos = list(measure).index(target_note)
            for idx_offset, gn in enumerate(created_notes):
                measure.insert(target_pos + idx_offset, gn)
        else:
            anchor_child = notes[insert_after_idx]
            pos = list(measure).index(anchor_child) + 1
            while pos < len(measure):
                nxt = list(measure)[pos]
                if _local(nxt) == "note" and nxt.find(_q(ns, "chord")) is not None:
                    pos += 1
                else:
                    break
            for idx_offset, gn in enumerate(created_notes):
                measure.insert(pos + idx_offset, gn)

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

    if kind == "setPlayOrder":
        try:
            idx = int(fix.get("noteIndex"))
        except (TypeError, ValueError):
            return False
        try:
            order = int(fix.get("playOrder"))
        except (TypeError, ValueError):
            return False
        if idx < 0 or idx >= len(notes):
            return False
        leader_i = _chord_leader_index(notes, ns, idx)
        changed = _set_play_order_same_pitch_staff_leaders(
            notes, ns, leader_i, order, measure=measure
        )
        if order >= 1:
            _, staff = _note_voice_staff(notes[leader_i], ns)
            if _clear_play_order_on_other_onsets(
                measure, ns, notes, staff, leader_i, order
            ):
                changed = True
        return changed

    if kind == "addArticulation":
        try:
            idx = int(fix.get("noteIndex"))
        except (TypeError, ValueError):
            return False
        if idx < 0 or idx >= len(notes):
            return False
        art = str(fix.get("articulation") or "accent").strip().lower().replace("_", "-")
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
            if _local(existing).lower().replace("_", "-") == art:
                return False
        art_el = ET.SubElement(arts, _q(ns, art))
        placement = str(fix.get("placement") or "").strip().lower()
        if placement not in ("above", "below"):
            auto = _default_articulation_placement(note, ns)
            placement = auto or "below"
        art_el.set("placement", placement)

        custom_dy = fix.get("defaultY")
        dist_raw = fix.get("distance")
        dist = None if dist_raw in (None, "", "auto") else str(dist_raw).strip().lower()
        dy = _calc_safe_articulation_default_y(note, ns, placement, distance=dist, custom_dy=custom_dy)
        if dy is not None:
            art_el.set("default-y", str(dy))
        _set_articulation_distance_on_el(art_el, dist)
        _normalize_articulation_engraving_on_note(note, ns)
        return True

    if kind == "setArticulationPlacement":
        try:
            idx = int(fix.get("noteIndex"))
        except (TypeError, ValueError):
            return False
        if idx < 0 or idx >= len(notes):
            return False
        art = str(fix.get("articulation") or "").strip().lower().split("(")[0].replace("_", "-")
        placement = str(fix.get("placement") or "").strip().lower()
        custom_dy = fix.get("defaultY")
        dist_raw = fix.get("distance")
        dist = None if dist_raw in (None, "", "auto") else str(dist_raw).strip().lower()
        if art not in _ARTICULATION_TAGS:
            return False

        def _note_has_target_art(n: ET.Element) -> bool:
            for nots in n.findall(_q(ns, "notations")):
                for arts in nots.findall(_q(ns, "articulations")):
                    for el in arts:
                        if _local(el).lower().replace("_", "-") == art:
                            return True
            return False

        target_note = notes[idx]
        if not _note_has_target_art(target_note):
            # 1. chord leader fallback
            leader_i = _chord_leader_index(notes, ns, idx)
            if leader_i < len(notes) and _note_has_target_art(notes[leader_i]):
                target_note = notes[leader_i]
            else:
                # 2. measure-wide fallback
                for n in notes:
                    if _note_has_target_art(n):
                        target_note = n
                        break

        note = target_note
        changed = False
        for notations in note.findall(_q(ns, "notations")):
            for arts in notations.findall(_q(ns, "articulations")):
                for el in arts:
                    if _local(el).lower().replace("_", "-") != art:
                        continue
                    effective_placement = placement if placement in ("above", "below") else (el.get("placement") or "below")
                    if el.get("placement") != effective_placement:
                        el.set("placement", effective_placement)
                        changed = True
                    dy = _calc_safe_articulation_default_y(note, ns, effective_placement, distance=dist, custom_dy=custom_dy)
                    if dy is not None:
                        if el.get("default-y") != str(dy):
                            el.set("default-y", str(dy))
                            changed = True
                    elif custom_dy is not None:
                        if el.get("default-y") != str(custom_dy):
                            el.set("default-y", str(custom_dy))
                            changed = True
                    _set_articulation_distance_on_el(el, dist)
                    changed = True
        if _normalize_articulation_engraving_on_note(note, ns):
            changed = True
        return changed

    if kind == "addOrnament":
        try:
            idx = int(fix.get("noteIndex"))
        except (TypeError, ValueError):
            return False
        if idx < 0 or idx >= len(notes):
            return False
        orn = str(fix.get("ornament") or "").strip().lower().split("(")[0]
        if ":" in orn:
            orn = orn.split(":", 1)[0]
        if orn not in _ORNAMENT_TAGS:
            return False
        note = notes[idx]
        if note.find(_q(ns, "rest")) is not None:
            return False
        notations = _ensure_notations(note, ns)
        orns = notations.find(_q(ns, "ornaments"))
        if orns is None:
            orns = ET.SubElement(notations, _q(ns, "ornaments"))
        for existing in orns:
            if _local(existing) == orn:
                return False
        orn_el = ET.SubElement(orns, _q(ns, orn))
        placement = str(fix.get("placement") or "").strip().lower()
        if placement in ("above", "below"):
            orn_el.set("placement", placement)
        else:
            orn_el.set("placement", "above")
        return True

    if kind == "insertWedge":
        wtype = str(fix.get("directionValue") or fix.get("wedgeType") or "crescendo").strip().lower()
        if wtype not in ("crescendo", "diminuendo"):
            wtype = "crescendo"
        try:
            start_i = int(fix.get("fromNoteIndex"))
            end_i = int(fix.get("toNoteIndex"))
            staff_n = int(fix.get("staff", 1))
        except (TypeError, ValueError):
            return False
        if start_i < 0:
            start_i = 0
        placement = str(fix.get("placement") or "below").strip().lower()
        if placement not in ("above", "below"):
            placement = "below"
        start_spread = "0" if wtype == "crescendo" else "15"
        stop_spread = "15" if wtype == "crescendo" else "0"
        wedge_no = _next_wedge_number(measure, ns)
        if end_i < 0:
            end_i = _last_rhythmic_note_index_on_staff(notes, ns, staff_n)
        _insert_standalone_wedge(
            measure,
            ns,
            notes,
            wtype=wtype,
            staff_n=staff_n,
            placement=placement,
            before_note_index=start_i,
            wedge_spread=start_spread,
            wedge_number=wedge_no,
        )
        _insert_standalone_wedge(
            measure,
            ns,
            notes,
            wtype="stop",
            staff_n=staff_n,
            placement=placement,
            after_note_index=end_i if end_i >= 0 else None,
            wedge_spread=stop_spread,
            wedge_number=wedge_no,
        )
        return True

    if kind == "moveWedgeStop":
        try:
            staff_n = int(fix.get("staff", 1))
        except (TypeError, ValueError):
            return False
        before_idx = fix.get("beforeNoteIndex")
        if before_idx is None:
            before_idx = fix.get("toNoteIndex", fix.get("noteIndex"))
        try:
            before_idx = int(before_idx)
        except (TypeError, ValueError):
            return False
        placement = str(fix.get("placement") or "below").strip().lower()
        if placement not in ("above", "below"):
            placement = "below"
        wedge_no = _open_wedge_number_on_staff(measure, ns, staff_n)
        _remove_wedge_stops_on_staff(measure, ns, staff_n)
        notes = [c for c in list(measure) if _local(c) == "note"]
        end_i = before_idx
        if end_i < 0:
            end_i = _last_rhythmic_note_index_on_staff(notes, ns, staff_n)
        _insert_standalone_wedge(
            measure,
            ns,
            notes,
            wtype="stop",
            staff_n=staff_n,
            placement=placement,
            after_note_index=end_i if end_i >= 0 else None,
            wedge_number=wedge_no,
        )
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
            plc = _tie_placement_for_note(from_note, ns, part=part, measure=from_measure)
            if plc:
                start.set("placement", plc)
        else:
            for tied in from_not.findall(_q(ns, "tied")):
                if (tied.get("type") or "") == "start":
                    plc = _tie_placement_for_note(from_note, ns, part=part, measure=from_measure)
                    if plc:
                        tied.set("placement", plc)
        if not has_stop:
            stop = ET.SubElement(to_not, _q(ns, "tied"))
            stop.set("type", "stop")
            plc = _tie_placement_for_note(to_note, ns, part=to_part, measure=to_measure)
            if plc:
                stop.set("placement", plc)
        else:
            for tied in to_not.findall(_q(ns, "tied")):
                if (tied.get("type") or "") == "stop":
                    plc = _tie_placement_for_note(to_note, ns, part=to_part, measure=to_measure)
                    if plc:
                        tied.set("placement", plc)
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

        for s in list(from_not.findall(_q(ns, "slur"))):
            if s.get("type") == "start":
                from_not.remove(s)
        for s in list(to_not.findall(_q(ns, "slur"))):
            if s.get("type") == "stop":
                to_not.remove(s)

        # from~to 사이 같은 staff의 고아/짧은 OMR stop·start 제거 — 긴 이음줄이 중간에서 끊기지 않게
        from_staff = _note_staff_number(from_note, ns) or 1
        lo, hi = (from_idx, to_idx) if from_idx <= to_idx else (to_idx, from_idx)
        for mid_i in range(lo + 1, hi):
            mid = notes[mid_i]
            if (_note_staff_number(mid, ns) or 1) != from_staff:
                continue
            mid_not = mid.find(_q(ns, "notations"))
            if mid_not is None:
                continue
            for s in list(mid_not.findall(_q(ns, "slur"))):
                mid_not.remove(s)
            if not list(mid_not):
                mid.remove(mid_not)

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

        placement = str(fix.get("placement") or "").strip().lower()
        if placement not in ("above", "below"):
            plc_from = get_placement(from_note)
            plc_to = get_placement(to_note)
            placement = plc_from if plc_from == plc_to else (plc_from or "below")

        start = ET.SubElement(from_not, _q(ns, "slur"))
        start.set("type", "start")
        start.set("number", str(new_num))
        if placement:
            start.set("placement", placement)

        stop = ET.SubElement(to_not, _q(ns, "slur"))
        stop.set("type", "stop")
        stop.set("number", str(new_num))
        if placement:
            stop.set("placement", placement)

        return True

    if kind == "setSlurPlacement":
        try:
            idx = int(fix.get("noteIndex"))
        except (TypeError, ValueError):
            return False
        placement = str(fix.get("placement") or "").strip().lower()
        if placement not in ("above", "below"):
            return False
        which = str(fix.get("slurEnd") or "both").strip().lower()
        if which not in ("start", "stop", "both"):
            which = "both"
        return _set_slur_pair_placement(notes, ns, idx, which, placement)

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
        voice_override = str(fix.get("voice") or "").strip()
        voice, _stem = _infer_voice_stem_from_neighbors(notes, ns, insert_after_idx, staff_n)
        if voice_override:
            voice = voice_override
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
        if anchor is not None:
            anchor_po = _read_play_order(anchor)
            if anchor_po is not None:
                new_po = anchor_po + 1
                for n in notes:
                    if n.find(_q(ns, "chord")) is not None:
                        continue
                    if (_note_staff_number(n, ns) or 1) != staff_n:
                        continue
                    cur_po = _read_play_order(n)
                    if cur_po is not None and cur_po >= new_po:
                        _set_play_order_on_leader(notes, ns, notes.index(n), cur_po + 1)
                new_note.set(PLAY_ORDER_ATTR, str(new_po))
        elif after_idx < 0:
            has_any_po = any(
                _read_play_order(n) is not None
                for n in notes
                if (_note_staff_number(n, ns) or 1) == staff_n
            )
            if has_any_po:
                new_note.set(PLAY_ORDER_ATTR, "1")
                for n in notes:
                    if n.find(_q(ns, "chord")) is not None:
                        continue
                    if (_note_staff_number(n, ns) or 1) != staff_n:
                        continue
                    cur_po = _read_play_order(n)
                    if cur_po is not None:
                        _set_play_order_on_leader(notes, ns, notes.index(n), cur_po + 1)
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
        voice_override = str(fix.get("voice") or "").strip()
        voice, stem = _infer_voice_stem_from_neighbors(notes, ns, insert_after_idx, staff_n)
        if voice_override:
            voice = voice_override
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
        if anchor is not None:
            anchor_po = _read_play_order(anchor)
            if anchor_po is not None:
                new_po = anchor_po + 1
                for n in notes:
                    if n.find(_q(ns, "chord")) is not None:
                        continue
                    if (_note_staff_number(n, ns) or 1) != staff_n:
                        continue
                    cur_po = _read_play_order(n)
                    if cur_po is not None and cur_po >= new_po:
                        _set_play_order_on_leader(notes, ns, notes.index(n), cur_po + 1)
                new_note.set(PLAY_ORDER_ATTR, str(new_po))
        elif after_idx < 0:
            has_any_po = any(
                _read_play_order(n) is not None
                for n in notes
                if (_note_staff_number(n, ns) or 1) == staff_n
            )
            if has_any_po:
                new_note.set(PLAY_ORDER_ATTR, "1")
                for n in notes:
                    if n.find(_q(ns, "chord")) is not None:
                        continue
                    if (_note_staff_number(n, ns) or 1) != staff_n:
                        continue
                    cur_po = _read_play_order(n)
                    if cur_po is not None:
                        _set_play_order_on_leader(notes, ns, notes.index(n), cur_po + 1)
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
        applied = _apply_beam_to_range(notes, ns, indices, beam_number, divisions)
        if applied:
            _clean_orphan_beams_in_measure(measure, ns)
            _normalize_measure_note_engraving(part, ns, measure)
        return applied

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
                beam_number = None
        changed = False
        for idx in range(from_idx, to_idx + 1):
            if _strip_beams_from_note(notes[idx], ns, beam_number):
                changed = True
            for fidx in _chord_follower_indices(notes, ns, idx):
                if _strip_beams_from_note(notes[fidx], ns, beam_number):
                    changed = True
        _clean_orphan_beams_in_measure(measure, ns)
        _normalize_measure_note_engraving(part, ns, measure)
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
        "restDisplayPinned": 0,
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

            staff_voices: dict[int, set[str]] = {}
            for note in list_note_elements(measure, ns):
                if note.find(_q(ns, "grace")) is not None:
                    continue
                if note.find(_q(ns, "chord")) is not None:
                    continue
                staff_n = _note_staff_number(note, ns) or 1
                voice_el = note.find(_q(ns, "voice"))
                voice = (
                    (voice_el.text or "1").strip()
                    if voice_el is not None and voice_el.text
                    else "1"
                )
                staff_voices.setdefault(staff_n, set()).add(voice)

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

            # 다성부 짧은 쉼: 오선 중선에 고정. 단성부는 힌트 제거(OSMD 기본 위치).
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
                staff_n = _note_staff_number(note, ns) or 1
                if len(staff_voices.get(staff_n, ())) >= 2:
                    sign, line = _clef_for_note_in_part(part, measure, note, ns)
                    step, octave = _from_diatonic_index(_middle_line_diatonic(sign, line))
                    if _set_rest_display_step_octave(rest_el, ns, step, octave):
                        stats["restDisplayPinned"] += 1
                        measure_changed = True
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
    if (
        stats["restsFixed"] > 0
        or stats["restDisplayCleared"] > 0
        or stats["restDisplayPinned"] > 0
        or stats["tupletStaccatoRemoved"] > 0
    ):
        write_mxl_root(mxl_path, files, root_path, root)
    return {"path": str(mxl_path), **stats}


_SAME_X_TOLERANCE = 2.0
# 반대 줄기 동시 onset — Audiveris는 보통 거의 같은 default-x.
# 72는 빔 끝 8분→다음 4분(Δ≈30)까지 동시로 오인해 voice 분리·순번 붕괴를 일으킴.
_PARALLEL_STEM_X_TOLERANCE = 16.0


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


def _parallel_groups_may_cluster(
    prev_grp: list[ET.Element], next_grp: list[ET.Element], ns: str, cluster_x: float, next_x: float
) -> bool:
    """default-x·줄기 허용폭 + 빔 연속(순차)이면 동시 cluster 금지."""
    if not prev_grp or not next_grp:
        return False
    # default-x 없음(1e6 sentinel)은 동시 onset 증거가 아님 — 순차 8분음이 한 화음이 되면 안 됨
    if cluster_x >= 999_000.0 or next_x >= 999_000.0:
        return False
    merged = [prev_grp, next_grp]
    tol = _parallel_cluster_x_tolerance(merged, ns)
    if abs(next_x - cluster_x) > tol:
        return False
    prev_beams = _note_beams(prev_grp[0], ns)
    next_beams = _note_beams(next_grp[0], ns)
    # 빔 끝 다음 음·빔 연속은 순차 — SAME_X일 때만 동시로 봄
    if "end" in prev_beams and not next_beams:
        return abs(next_x - cluster_x) <= _SAME_X_TOLERANCE
    if prev_beams and next_beams and any(b in ("continue", "end") for b in next_beams):
        return abs(next_x - cluster_x) <= _SAME_X_TOLERANCE
    return True


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
            if st != staff:
                continue
            last_note_voice = voice
            try:
                ni = notes.index(el)
            except ValueError:
                continue
            start = voice_cursor.get(voice, 0)
            out.append((ni, start))
            if not _is_grace_or_cue(el, ns):
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
        keeper_pitches: set[tuple[str, int, int]] = set()
        for note in groups[keeper_i]:
            key = _note_pitch_key(note, ns)
            if key is not None:
                keeper_pitches.add(key)
            if note.get("default-x") != f"{x_val:.2f}":
                note.set("default-x", f"{x_val:.2f}")
                changed = True
        for i, grp in enumerate(groups):
            if i == keeper_i:
                continue
            for note in list(grp):
                key = _note_pitch_key(note, ns)
                if key is not None and key in keeper_pitches:
                    # 이미 같은 피치가 있으면 화음 멤버로 붙이지 않고 버린다(원본에 없는 유니즌 중복).
                    if note in list(measure):
                        measure.remove(note)
                        changed = True
                    continue
                if _ensure_chord_tag(note, ns):
                    changed = True
                if key is not None:
                    keeper_pitches.add(key)
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
    if _compact_default_x_by_staff(measure, ns):
        changed = True
    defaults = _default_play_orders_for_staff(measure, ns, staff)
    parallel_order = min(
        defaults.get(_chord_leader_index(notes, ns, i), i + 1) for i in selected
    )
    for i in selected:
        leader_i = _chord_leader_index(notes, ns, i)
        if _set_play_order_same_pitch_staff_leaders(
            notes, ns, leader_i, parallel_order, measure=measure
        ):
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
    has_po = any(_read_play_order(grp[0]) is not None for grp in groups)
    if has_po:
        def _grp_po(grp: list[ET.Element]) -> tuple[int, float, int]:
            po = _read_play_order(grp[0])
            if po is not None:
                return (po, 0.0, list(notes).index(grp[0]) if grp[0] in notes else 0)
            dx = _parse_default_x(grp[0]) or 999_999.0
            return (999_999, dx, list(notes).index(grp[0]) if grp[0] in notes else 0)

        groups.sort(key=_grp_po)
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
    clusters: list[tuple[float, list[list[ET.Element]]]] = []
    for grp in leaders:
        x = _parse_default_x(grp[0])
        x_val = x if x is not None else 1_000_000.0
        if clusters:
            prev_grp = clusters[-1][1][-1]
            if _parallel_groups_may_cluster(prev_grp, grp, ns, clusters[-1][0], x_val):
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
            prev_grp = clusters[-1][1][-1]
            if _parallel_groups_may_cluster(prev_grp, grp, ns, clusters[-1][0], x_val):
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
    """backup·다중 voice가 있는 마디 — 같은 (voice, staff) 음표들을 연속된 타임라인 스트림으로 통합 및 정렬."""
    start_elements: list[ET.Element] = []
    end_elements: list[ET.Element] = []
    note_attachments: dict[ET.Element, list[ET.Element]] = {}
    note_preamble: dict[ET.Element, list[ET.Element]] = {}
    staff_preamble: dict[int, list[ET.Element]] = {}

    voice_notes: dict[tuple[str, str], list[ET.Element]] = {}
    staff_voices: dict[str, list[str]] = {}
    last_seen_note: ET.Element | None = None

    for el in list(measure):
        tag = _local(el)
        if tag == "note":
            voice, staff = _note_voice_staff(el, ns)
            key = (voice, staff)
            if key not in voice_notes:
                voice_notes[key] = []
                if staff not in staff_voices:
                    staff_voices[staff] = []
                if voice not in staff_voices[staff]:
                    staff_voices[staff].append(voice)
            voice_notes[key].append(el)
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

    if not voice_notes:
        return

    # 성부별 음표 정렬 (play order, default-x, onset 순)
    for key in voice_notes:
        voice_notes[key] = _sort_notes_by_default_x(voice_notes[key], ns)

    staff_preamble_emitted: set[int] = set()
    for el in list(measure):
        measure.remove(el)
    for el in start_elements:
        measure.append(el)

    sorted_staves = sorted(staff_voices.keys(), key=lambda s: int(s) if s.isdigit() else 999)
    first_staff = True
    prev_staff_dur = 0

    for st in sorted_staves:
        try:
            st_n = int(st)
        except ValueError:
            st_n = 1
        if st_n not in staff_preamble_emitted:
            for pre in staff_preamble.get(st_n, []):
                measure.append(pre)
            staff_preamble_emitted.add(st_n)

        v_list = sorted(staff_voices[st], key=lambda v: int(v) if v.isdigit() else 999)
        first_voice = True
        prev_voice_dur = 0
        staff_dur = 0

        for v in v_list:
            notes = voice_notes.get((v, st), [])
            if not notes:
                continue
            v_dur = 0
            for n in notes:
                if n.find(_q(ns, "chord")) is None and n.find(_q(ns, "grace")) is None:
                    d_el = n.find(_q(ns, "duration"))
                    if d_el is not None and d_el.text and d_el.text.strip().isdigit():
                        v_dur += int(d_el.text.strip())

            if not first_voice:
                b_el = ET.Element(_q(ns, "backup"))
                d_el = ET.SubElement(b_el, _q(ns, "duration"))
                d_el.text = str(prev_voice_dur)
                measure.append(b_el)
            elif not first_staff:
                b_el = ET.Element(_q(ns, "backup"))
                d_el = ET.SubElement(b_el, _q(ns, "duration"))
                d_el.text = str(prev_staff_dur)
                measure.append(b_el)

            for note in notes:
                for pre in note_preamble.get(note, []):
                    measure.append(pre)
                measure.append(note)
                for att in note_attachments.get(note, []):
                    measure.append(att)

            prev_voice_dur = v_dur
            staff_dur = max(staff_dur, v_dur)
            first_voice = False

        prev_staff_dur = staff_dur
        first_staff = False

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
    has_po = any(_read_play_order(g[0]) is not None for g in groups)
    if has_po:
        def _grp_sort_key(grp: list[ET.Element]) -> tuple[int, float, int]:
            po = _read_play_order(grp[0])
            if po is not None:
                return (po, 0.0, notes.index(grp[0]))
            dx = _parse_default_x(grp[0]) or 999_999.0
            return (999_999, dx, notes.index(grp[0]))

        indexed = [
            (grp, _grp_sort_key(grp), notes.index(grp[0]))
            for grp in groups
        ]
        indexed.sort(key=lambda t: t[1])
    else:
        return False
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


def rebuild_measure_timeline_clean(
    measure: ET.Element, ns: str, part: ET.Element | None = None
) -> None:
    """HITL 삽입 후 마디 timeline 정렬. 다중 voice·동시 시작(다른 박자) 보존."""
    notes = list_note_elements(measure, ns)
    _fix_chord_tag_consistency(notes, ns)
    _sync_all_chord_groups(notes, ns)
    _dedupe_identical_pitches_in_chord_groups(measure, ns)
    coalesce_spurious_parallel_voices_in_measure(measure, ns, part)
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
    _dedupe_identical_pitches_in_chord_groups(measure, ns)
    for staff in ("1", "2"):
        _merge_staff_voices_if_non_overlapping(measure, ns, staff)
    for staff in ("1", "2"):
        _normalize_staff_note_order(measure, ns, staff)
    _compact_default_x_by_staff(measure, ns, part)
    _repair_tuplet_brackets_in_measure(measure, ns)
    _clean_orphan_beams_in_measure(measure, ns)


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
    # direction·템포만 추가·삭제·수정 — 음표 timeline·default-x·voice를 건드리지 않음
    skip_rebuild_kinds = {
        "linkParallelOnsets",
        "setPlayOrder",
        "insertDirection",
        "removeDirection",
        "removeSpuriousDirection",
        "setMeasureDirectionText",
        "addNoteDirection",
        "removeNoteDirection",
        "setNoteDirection",
        "clearNoteDirection",
        "setMeasureTempo",
        "removeMeasureTempo",
        "addArticulation",
        "removeArticulation",
        "setArticulationPlacement",
        "addOrnament",
        "removeOrnament",
        "insertWedge",
        "moveWedgeStop",
        "setMeasureClef",
        "setPartClef",
        "copyMeasureContent",
        "copyMeasurePart",
    }
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
            rebuild_measure_timeline_clean(measure, ns, part)
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
    rest_play_order_measures = normalize_play_orders_including_rests_in_root(root)
    coalesce_voice_measures = coalesce_spurious_parallel_voices_in_root(root)
    timeline_measures = normalize_measure_timelines_in_root(root)
    dynamics_normalized = normalize_dynamics_in_root(root)
    slurs_normalized = normalize_slurs_in_root(root)
    wedges_normalized = normalize_wedges_in_root(root)
    chord_pitch_dupes = dedupe_identical_chord_pitches_in_root(root)
    write_mxl_root(mxl_path, files, root_path, root)
    return {
        "path": str(mxl_path),
        **stats,
        "fixCount": len(fixes),
        "chordBeamMeasuresCleaned": chord_beam_measures,
        "restPlayOrderMeasuresNormalized": rest_play_order_measures,
        "coalesceVoiceMeasures": max(coalesce_voice_measures, timeline_measures),
        "dynamicsNormalizedMeasures": dynamics_normalized,
        "slursNormalizedMeasures": slurs_normalized,
        "wedgesNormalizedMeasures": wedges_normalized,
        "chordPitchDedupeMeasures": chord_pitch_dupes,
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
