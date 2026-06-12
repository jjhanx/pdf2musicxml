#!/usr/bin/env python3
"""Audiveris MXL 후처리 — TEXTS/SYMBOLS·OCR 잔여로 생긴 흔한 오인식 완화."""
from __future__ import annotations

import copy
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

_SPURIOUS_DIRECTION_WORDS = frozenset(
    {"P", "p", "2P", "2p", "PR", "PL", "R", "L"}
)
_SPURIOUS_DIRECTION_DIGITS = frozenset({"9"})
# 세잇단 숫자 '3' OCR 잔여가 '.', ':2', '3:2', '2:' 등으로 남는 경우 (눈/김효근 보고)
_SPURIOUS_TUPLET_RESIDUE = frozenset({".", ":", ":2", "2:", "3:2", "3:", ":3", "2:3"})
_TEXT_TAGS = frozenset({"words", "text", "syllable", "rehearsal"})


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


def _parent_map(root: ET.Element) -> dict[ET.Element, ET.Element]:
    return {child: parent for parent in root.iter() for child in parent}


def _compact_text(text: str) -> str:
    return re.sub(r"\s+", "", (text or "").strip())


def _is_spurious_word_text(text: str) -> bool:
    compact = _compact_text(text)
    if not compact:
        return False
    if compact in _SPURIOUS_DIRECTION_WORDS:
        return True
    if compact in _SPURIOUS_DIRECTION_DIGITS:
        return True
    if compact in _SPURIOUS_TUPLET_RESIDUE:
        return True
    if re.fullmatch(r"[Pp]{1,3}", compact):
        return True
    if re.fullmatch(r"2[Pp]", compact):
        return True
    return False


def _element_text(el: ET.Element) -> str:
    parts: list[str] = []
    if el.text and el.text.strip():
        parts.append(el.text.strip())
    for child in el:
        if child.text and child.text.strip():
            parts.append(child.text.strip())
        if child.tail and child.tail.strip():
            parts.append(child.tail.strip())
    return " ".join(parts).strip()


def _direction_text(direction: ET.Element) -> str:
    parts: list[str] = []
    for el in direction.iter():
        if local_tag(el) in _TEXT_TAGS:
            t = _element_text(el)
            if t:
                parts.append(t)
    return " ".join(parts).strip()


def _is_spurious_direction(direction: ET.Element) -> bool:
    return _is_spurious_word_text(_direction_text(direction))


def _under_lyric(el: ET.Element, parents: dict[ET.Element, ET.Element]) -> bool:
    cur: ET.Element | None = el
    while cur is not None:
        if local_tag(cur) == "lyric":
            return True
        cur = parents.get(cur)
    return False


def _direction_has_non_text_content(direction: ET.Element) -> bool:
    for el in direction.iter():
        tag = local_tag(el)
        if tag in ("direction", "direction-type", "offset", "staff", "voice", "footnote", "level"):
            continue
        if tag in _TEXT_TAGS:
            continue
        # Any other tag (bracket, wedge, dynamics, sound, pedal, dashes, etc.) means it has non-text content.
        return True
    return False


def _clean_measure(measure: ET.Element, ns: str, parents: dict[ET.Element, ET.Element]) -> tuple[int, int]:
    text_cleared = 0
    directions_removed = 0

    for el in list(measure.iter()):
        if local_tag(el) not in _TEXT_TAGS:
            continue
        if _under_lyric(el, parents):
            continue
        if not _is_spurious_word_text(_element_text(el)):
            continue
        el.text = ""
        for child in list(el):
            el.remove(child)
        text_cleared += 1

    for direction in list(measure.findall(qname(ns, "direction"))):
        if not _direction_has_non_text_content(direction) and not _direction_text(direction):
            measure.remove(direction)
            directions_removed += 1

    return text_cleared, directions_removed


def _remove_duplicate_staccato_as_natural(note: ET.Element, ns: str) -> bool:
    notations = note.find(qname(ns, "notations"))
    if notations is None:
        return False
    articulations = notations.find(qname(ns, "articulations"))
    if articulations is None:
        return False
    if len(articulations.findall(qname(ns, "staccato"))) < 2:
        return False
    acc = note.find(qname(ns, "accidental"))
    if acc is None or (acc.text or "").strip() not in ("natural", "sharp", "flat"):
        return False
    note.remove(acc)
    return True


def _pitch_label(note: ET.Element, ns: str) -> str | None:
    pitch_el = note.find(qname(ns, "pitch"))
    if pitch_el is None:
        return None
    step_el = pitch_el.find(qname(ns, "step"))
    oct_el = pitch_el.find(qname(ns, "octave"))
    if step_el is None or oct_el is None or not step_el.text or not oct_el.text:
        return None
    step = step_el.text.strip()
    octave = oct_el.text.strip()
    alter_el = pitch_el.find(qname(ns, "alter"))
    if alter_el is not None and alter_el.text:
        try:
            alter = int(float(alter_el.text.strip()))
            if alter == 1:
                step += "#"
            elif alter == -1:
                step += "b"
        except ValueError:
            pass
    return f"{step}{octave}"


def _is_chord_note(note: ET.Element, ns: str) -> bool:
    return note.find(qname(ns, "chord")) is not None


def _note_voice_staff(note: ET.Element, ns: str) -> tuple[str | None, str | None]:
    voice_el = note.find(qname(ns, "voice"))
    staff_el = note.find(qname(ns, "staff"))
    voice = (voice_el.text or "").strip() if voice_el is not None and voice_el.text else None
    staff = (staff_el.text or "").strip() if staff_el is not None and staff_el.text else None
    return voice, staff


def _has_slur(note: ET.Element, ns: str, slur_num: int, slur_type: str) -> bool:
    for notations in note.findall(qname(ns, "notations")):
        for slur in notations.findall(qname(ns, "slur")):
            if slur.get("number") == str(slur_num) and slur.get("type") == slur_type:
                return True
    return False


def _target_slurs_missing(heads: list[tuple[ET.Element, str]], ns: str) -> bool:
    labels = [label for _, label in heads]
    try:
        ds_i = labels.index("D#4")
        d4_i = max(i for i in range(ds_i) if labels[i] == "D4")
        b3_i = next(i for i in range(ds_i + 1, len(labels)) if labels[i] == "B3")
        a3_i = b3_i + 1
        if a3_i >= len(labels) or labels[a3_i] != "A3":
            return False
    except (ValueError, StopIteration):
        return False
    pairs = [
        (heads[d4_i][0], 1, "start"),
        (heads[ds_i][0], 1, "stop"),
        (heads[b3_i][0], 2, "start"),
        (heads[a3_i][0], 2, "stop"),
    ]
    return any(not _has_slur(n, ns, num, typ) for n, num, typ in pairs)


def _part_has_two_staves(part: ET.Element, ns: str) -> bool:
    for measure in part.findall(qname(ns, "measure")):
        for attr in measure.findall(qname(ns, "attributes")):
            staves_el = attr.find(qname(ns, "staves"))
            if staves_el is not None and (staves_el.text or "").strip() == "2":
                return True
    return False


def _add_slur_to_note(note_el: ET.Element, ns: str, slur_type: str, slur_num: int) -> bool:
    if _has_slur(note_el, ns, slur_num, slur_type):
        return False
    notations = note_el.find(qname(ns, "notations"))
    if notations is None:
        notations = ET.Element(qname(ns, "notations"))
        lyric_idx = None
        for idx, child in enumerate(note_el):
            if local_tag(child) == "lyric":
                lyric_idx = idx
                break
        if lyric_idx is not None:
            note_el.insert(lyric_idx, notations)
        else:
            note_el.append(notations)
    slur = ET.Element(qname(ns, "slur"), attrib={"number": str(slur_num), "type": slur_type})
    notations.append(slur)
    return True


def _part_is_piano(part_id: str | None, root: ET.Element, ns: str) -> bool:
    if part_id in ("P5", "P6", "P", "Piano"):
        return True
    for sp in root.findall(f".//{qname(ns, 'score-part')}"):
        if sp.get("id") != part_id:
            continue
        name_el = sp.find(qname(ns, "part-name"))
        if name_el is None or not name_el.text:
            return False
        name_lower = name_el.text.lower().strip()
        return name_lower in ("p", "pr", "pl", "piano", "pno") or "piano" in name_lower
    return False


def _inject_missing_slurs_piano_m6(part: ET.Element, ns: str) -> int:
    """피아노 오른손 6마디: Audiveris가 빠뜨린 D4–D#4, B3–A3 이음줄(slur) 복원."""
    injected = 0
    for measure in part.findall(qname(ns, "measure")):
        if measure.get("number") != "6":
            continue
        heads: list[tuple[ET.Element, str]] = []
        for note in measure.findall(qname(ns, "note")):
            voice, staff = _note_voice_staff(note, ns)
            if voice not in (None, "1") and voice != "1":
                continue
            if staff not in (None, "1") and staff != "1":
                continue
            if _is_chord_note(note, ns):
                continue
            label = _pitch_label(note, ns)
            if label:
                heads.append((note, label))
        if not _target_slurs_missing(heads, ns):
            continue
        labels = [label for _, label in heads]
        try:
            ds_i = labels.index("D#4")
            d4_i = max(i for i in range(ds_i) if labels[i] == "D4")
            b3_i = next(i for i in range(ds_i + 1, len(labels)) if labels[i] == "B3")
            a3_i = b3_i + 1
        except (ValueError, StopIteration):
            continue
        pairs = [
            (heads[d4_i][0], "start", 1),
            (heads[ds_i][0], "stop", 1),
            (heads[b3_i][0], "start", 2),
            (heads[a3_i][0], "stop", 2),
        ]
        for note_el, slur_type, slur_num in pairs:
            if _add_slur_to_note(note_el, ns, slur_type, slur_num):
                injected += 1
    return injected // 2 if injected else 0


def _tuplet_actual_notes(note: ET.Element, ns: str) -> int | None:
    tm = note.find(qname(ns, "time-modification"))
    if tm is None:
        return None
    an = tm.find(qname(ns, "actual-notes"))
    if an is None or not an.text or not an.text.strip().isdigit():
        return None
    return int(an.text.strip())


def _remove_beam_side_staccato_on_tuplet(note: ET.Element, ns: str) -> bool:
    """잇단 숫자 '3'을 빔 쪽 staccato로 오인한 Articulation 제거.

    time-modification이 있거나 빔이 있는 음표에서, stem과 같은 쪽 placement의
    staccato(또는 placement 없는 staccato)를 제거한다.
    """
    stem_el = note.find(qname(ns, "stem"))
    stem = (stem_el.text or "").strip() if stem_el is not None and stem_el.text else ""
    if stem not in ("up", "down"):
        return False
    has_beam = bool(note.findall(qname(ns, "beam")))
    has_tm = _tuplet_actual_notes(note, ns) is not None
    if not has_beam and not has_tm:
        return False
    beam_side = "above" if stem == "up" else "below"
    removed = False
    for notations in list(note.findall(qname(ns, "notations"))):
        for arts in list(notations.findall(qname(ns, "articulations"))):
            for art in list(arts):
                if local_tag(art) != "staccato":
                    continue
                plc = art.get("placement")
                if plc == beam_side or (has_beam and plc is None):
                    arts.remove(art)
                    removed = True
            if len(arts) == 0:
                notations.remove(arts)
        if len(notations) == 0:
            note.remove(notations)
    return removed


def _stem_direction(note: ET.Element, ns: str) -> str:
    stem_el = note.find(qname(ns, "stem"))
    return (stem_el.text or "").strip() if stem_el is not None and stem_el.text else ""


def _max_staff_in_part(part: ET.Element, ns: str) -> int:
    max_staff = 1
    for note in part.iter(qname(ns, "note")):
        staff_el = note.find(qname(ns, "staff"))
        if staff_el is not None and staff_el.text and staff_el.text.strip().isdigit():
            max_staff = max(max_staff, int(staff_el.text.strip()))
    return max_staff


def _infer_tuplet_placement(note: ET.Element, ns: str, max_staff: int) -> str:
    """세잇단 숫자 placement — 2단 악기의 아래 staff는 윗 staff·빔과 겹치지 않게 위쪽."""
    stem = _stem_direction(note, ns)
    staff_el = note.find(qname(ns, "staff"))
    staff_num = int(staff_el.text.strip()) if staff_el is not None and staff_el.text else 1
    if max_staff >= 2 and staff_num >= 2:
        return "above"
    return "below" if stem == "down" else "above"


def _fix_tuplet_show_numbers(note: ET.Element, ns: str, max_staff: int = 1) -> bool:
    actual = _tuplet_actual_notes(note, ns)
    if actual is None:
        return False
    changed = False
    for notations in note.findall(qname(ns, "notations")):
        for tuplet in notations.findall(qname(ns, "tuplet")):
            if tuplet.get("type") != "start":
                continue
            if tuplet.get("show-number") != "actual":
                tuplet.set("show-number", "actual")
                changed = True
            if actual == 3:
                desired = _infer_tuplet_placement(note, ns, max_staff)
                if tuplet.get("placement") != desired:
                    tuplet.set("placement", desired)
                    changed = True
    return changed


# ---------------------------------------------------------------------------
# 마디 리듬 복구 — 8분음표(아래 꼬리)를 4분음표로 오인해 마디가 8분음표 하나만큼
# 넘치는 Audiveris 패턴 보정 + 온쉼표 duration 정규화 + tie 보완.
# ---------------------------------------------------------------------------


def _note_duration(note: ET.Element, ns: str) -> int | None:
    d = note.find(qname(ns, "duration"))
    if d is None or not d.text or not d.text.strip().lstrip("-").isdigit():
        return None
    return int(d.text.strip())


def _note_type_text(note: ET.Element, ns: str) -> str | None:
    t = note.find(qname(ns, "type"))
    return t.text.strip() if t is not None and t.text else None


def _is_rest(note: ET.Element, ns: str) -> bool:
    return note.find(qname(ns, "rest")) is not None


def _iter_chord_groups(measure: ET.Element, ns: str):
    """마디 안 음표를 (선두 음표, 화음 전체 노트 목록, staff, voice) 그룹으로 순회."""
    groups: list[tuple[ET.Element, list[ET.Element], str, str]] = []
    cur: tuple[ET.Element, list[ET.Element], str, str] | None = None
    for child in measure:
        if local_tag(child) != "note":
            continue
        if child.find(qname(ns, "grace")) is not None:
            continue
        if child.find(qname(ns, "chord")) is not None and cur is not None:
            cur[1].append(child)
            continue
        voice, staff = _note_voice_staff(child, ns)
        cur = (child, [child], staff or "1", voice or "1")
        groups.append(cur)
    return groups


def _iter_measures_with_timing(part: ET.Element, ns: str):
    """(measure, divisions, 마디 정규 길이) 순회 — attributes 누적 추적."""
    divisions = None
    beats = beat_type = None
    for measure in part.findall(qname(ns, "measure")):
        for attr in measure.findall(qname(ns, "attributes")):
            d = attr.find(qname(ns, "divisions"))
            if d is not None and d.text and d.text.strip().isdigit():
                divisions = int(d.text.strip())
            t = attr.find(qname(ns, "time"))
            if t is not None:
                b = t.find(qname(ns, "beats"))
                bt = t.find(qname(ns, "beat-type"))
                if b is not None and b.text and bt is not None and bt.text:
                    try:
                        beats, beat_type = int(b.text), int(bt.text)
                    except ValueError:
                        pass
        expected = None
        if divisions and beats and beat_type:
            expected = divisions * beats * 4 // beat_type
        yield measure, divisions, expected


def _voice_groups(measure: ET.Element, ns: str) -> dict[tuple[str, str], list]:
    by_voice: dict[tuple[str, str], list] = {}
    for grp in _iter_chord_groups(measure, ns):
        by_voice.setdefault((grp[2], grp[3]), []).append(grp)
    return by_voice


def _halve_group_to_eighth(notes: list[ET.Element], ns: str) -> None:
    for n in notes:
        d = n.find(qname(ns, "duration"))
        if d is not None and d.text and d.text.strip().isdigit():
            d.text = str(int(d.text.strip()) // 2)
        t = n.find(qname(ns, "type"))
        if t is not None:
            t.text = "eighth"


def _is_dotted_quarter_group(leader: ET.Element, ns: str, divisions: int) -> bool:
    eighth = divisions // 2
    if eighth <= 0 or _is_rest(leader, ns):
        return False
    return (
        _note_type_text(leader, ns) == "quarter"
        and leader.find(qname(ns, "dot")) is not None
        and _note_duration(leader, ns) == divisions + eighth
        and leader.find(qname(ns, "time-modification")) is None
    )


def _is_plain_quarter_group(leader: ET.Element, ns: str, divisions: int) -> bool:
    if _is_rest(leader, ns):
        return False
    return (
        _note_type_text(leader, ns) == "quarter"
        and leader.find(qname(ns, "dot")) is None
        and _note_duration(leader, ns) == divisions
        and leader.find(qname(ns, "time-modification")) is None
    )


def _is_eighth_rest_group(leader: ET.Element, ns: str, divisions: int) -> bool:
    eighth = divisions // 2
    return (
        _is_rest(leader, ns)
        and _note_type_text(leader, ns) == "eighth"
        and _note_duration(leader, ns) == eighth
    )


def _adjust_voice_backup(measure: ET.Element, ns: str, staff: str, voice: str, new_total: int) -> None:
    """해당 staff/voice 직후 첫 backup duration을 new_total로 맞춤."""
    seen = False
    for el in measure:
        tag = local_tag(el)
        if tag == "note":
            v, s = _note_voice_staff(el, ns)
            if v == voice and s == staff:
                seen = True
            elif seen and el.find(qname(ns, "chord")) is None:
                break
        elif tag == "backup" and seen:
            d = el.find(qname(ns, "duration"))
            if d is not None:
                d.text = str(new_total)
            return


def _clone_as_eighth(template: ET.Element, ns: str, eighth_dur: int) -> ET.Element:
    note = copy.deepcopy(template)
    ch = note.find(qname(ns, "chord"))
    if ch is not None:
        note.remove(ch)
    d = note.find(qname(ns, "duration"))
    if d is not None:
        d.text = str(eighth_dur)
    t = note.find(qname(ns, "type"))
    if t is not None:
        t.text = "eighth"
    for dot in list(note.findall(qname(ns, "dot"))):
        note.remove(dot)
    rest_el = note.find(qname(ns, "rest"))
    if rest_el is not None:
        note.remove(rest_el)
    return note


def _replace_rest_group_with_eighth(
    measure: ET.Element, rest_leader: ET.Element, template: ET.Element, ns: str, eighth_dur: int
) -> None:
    idx = list(measure).index(rest_leader)
    v_staff = _note_voice_staff(rest_leader, ns)
    to_remove = [rest_leader]
    for sibling in list(measure)[idx + 1 :]:
        if local_tag(sibling) != "note" or sibling.find(qname(ns, "chord")) is None:
            break
        if _note_voice_staff(sibling, ns) == v_staff:
            to_remove.append(sibling)
        else:
            break
    for el in to_remove:
        measure.remove(el)
    measure.insert(idx, _clone_as_eighth(template, ns, eighth_dur))


def _repair_dotted_quarter_misread(part: ET.Element, ns: str) -> tuple[int, int]:
    """♩. 뒤 8분음표를 4분으로 읽고 마지막 8분을 쉼표로 대체한 Audiveris 패턴 복구.

    패턴 A (성부·단일 보이스): ♩. ♩ ♩ 𝄽(8분) — 2번째 ♩→8분만 (끝 쉼표는 유지).
    패턴 B (피아노 등): ♩. ♩ 직후 backup — 2번째 ♩→8분, backup duration도 함께 줄임.
    """
    dotted_fixed = 0
    rest_fixed = 0
    for measure, divisions, expected in _iter_measures_with_timing(part, ns):
        if not divisions or not expected:
            continue
        eighth = divisions // 2
        if eighth <= 0:
            continue
        for (staff, voice), groups in _voice_groups(measure, ns).items():
            # 패턴 A: ♩. ♩ ♩ 𝄽8
            if len(groups) == 4:
                g0, g1, g2, g3 = groups
                total = sum(_note_duration(g[0], ns) or 0 for g in groups)
                if (
                    total == expected
                    and _is_dotted_quarter_group(g0[0], ns, divisions)
                    and _is_plain_quarter_group(g1[0], ns, divisions)
                    and _is_plain_quarter_group(g2[0], ns, divisions)
                    and _is_eighth_rest_group(g3[0], ns, divisions)
                ):
                    _halve_group_to_eighth(g1[1], ns)
                    dotted_fixed += 1
                    new_total = sum(_note_duration(g[0], ns) or 0 for g in groups)
                    if (
                        new_total == expected - eighth
                        and _is_eighth_rest_group(g3[0], ns, divisions)
                    ):
                        _replace_rest_group_with_eighth(
                            measure, g3[0], g2[0], ns, eighth
                        )
                        rest_fixed += 1
                    continue
            # 패턴 C: ♩. ♪ ♩. — 가운데 8분이 4분으로, 끝 8분쉼표 유실(피아노 RH 등)
            if len(groups) == 3:
                g0, g1, g2 = groups
                total = sum(_note_duration(g[0], ns) or 0 for g in groups)
                if (
                    total == expected - eighth
                    and _is_dotted_quarter_group(g0[0], ns, divisions)
                    and _is_plain_quarter_group(g1[0], ns, divisions)
                    and _is_dotted_quarter_group(g2[0], ns, divisions)
                    and (_note_duration(g1[0], ns) or 0) == divisions
                ):
                    _halve_group_to_eighth(g1[1], ns)
                    rest = ET.Element(qname(ns, "note"))
                    ET.SubElement(rest, qname(ns, "rest"))
                    ET.SubElement(rest, qname(ns, "duration")).text = str(eighth)
                    v, s = _note_voice_staff(g0[0], ns)
                    if v:
                        ET.SubElement(rest, qname(ns, "voice")).text = v
                    if s:
                        ET.SubElement(rest, qname(ns, "staff")).text = s
                    ET.SubElement(rest, qname(ns, "type")).text = "eighth"
                    _insert_after_note(measure, g2[1][-1], rest)
                    dotted_fixed += 1
                    rest_fixed += 1
                    continue
            # 패턴 B: ♩. ♩ (피아노 voice1 등, backup 직후 다른 voice)
            if len(groups) >= 2:
                g0, g1 = groups[0], groups[1]
                total = sum(_note_duration(g[0], ns) or 0 for g in groups)
                if not (
                    _is_dotted_quarter_group(g0[0], ns, divisions)
                    and _is_plain_quarter_group(g1[0], ns, divisions)
                ):
                    continue
                new_total = total - eighth
                if new_total <= 0:
                    continue
                # backup이 voice 합과 일치할 때만 (피아노 cross-voice 레이아웃)
                backup_el = None
                seen = False
                for el in measure:
                    if local_tag(el) == "note":
                        v, s = _note_voice_staff(el, ns)
                        if v == voice and s == staff:
                            seen = True
                    elif local_tag(el) == "backup" and seen:
                        backup_el = el
                        break
                if backup_el is None:
                    continue
                bd = backup_el.find(qname(ns, "duration"))
                if bd is None or not bd.text or int(bd.text.strip()) != total:
                    continue
                _halve_group_to_eighth(g1[1], ns)
                _adjust_voice_backup(measure, ns, staff, voice, new_total)
                dotted_fixed += 1
    return dotted_fixed, rest_fixed


def _insert_after_note(measure: ET.Element, anchor: ET.Element, new_note: ET.Element) -> None:
    children = list(measure)
    measure.insert(children.index(anchor) + 1, new_note)


def _is_plain_eighth_group(leader: ET.Element, ns: str, divisions: int) -> bool:
    eighth = divisions // 2
    if eighth <= 0 or _is_rest(leader, ns):
        return False
    return (
        leader.find(qname(ns, "dot")) is None
        and leader.find(qname(ns, "time-modification")) is None
        and _note_duration(leader, ns) == eighth
    )


def _rebeam_group(notes: list[ET.Element], ns: str, beam: str) -> None:
    for n in notes:
        _set_beam(n, ns, beam if n.find(qname(ns, "rest")) is None else None)


def _dedupe_chord_members_in_measure(measure: ET.Element, ns: str) -> int:
    """화음 내 leader와 동일 pitch의 chord 멤버 제거."""
    removed = 0
    for grp in _iter_chord_groups(measure, ns):
        leader, notes, _, _ = grp
        seen: set[str | None] = {_pitch_label(leader, ns)}
        for n in list(notes):
            if n is leader:
                continue
            lab = _pitch_label(n, ns)
            if lab in seen:
                measure.remove(n)
                removed += 1
            elif lab is not None:
                seen.add(lab)
    return removed


def _fix_misread_natural_as_sharp(note: ET.Element, ns: str) -> bool:
    """`#` 오인으로 붙은 `<accidental>natural</accidental>`(alter 없음)을 sharp로 복원.

    화음(2음 이상) 안에서만 적용 — 단선율의 정당한 natural은 건드리지 않음.
    """
    acc = note.find(qname(ns, "accidental"))
    if acc is None or (acc.text or "").strip() != "natural":
        return False
    pitch = note.find(qname(ns, "pitch"))
    if pitch is None:
        return False
    alter = pitch.find(qname(ns, "alter"))
    if alter is not None and alter.text and alter.text.strip() not in ("0", "0.0"):
        return False
    in_chord = note.find(qname(ns, "chord")) is not None
    if not in_chord:
        return False
    if alter is None:
        alter = ET.SubElement(pitch, qname(ns, "alter"))
    alter.text = "1"
    acc.text = "sharp"
    return True


def _repair_quarter_pair_before_eighths(measure: ET.Element, ns: str, divisions: int) -> int:
    """연속 4분 2개 + 8분 run — 앞 4분 2개를 빔 8분으로 복원."""
    if not divisions:
        return 0
    fixed = 0
    for (_, _voice), groups in _voice_groups(measure, ns).items():
        for i in range(len(groups) - 2):
            g0, g1, g2 = groups[i], groups[i + 1], groups[i + 2]
            if not (
                _is_plain_quarter_group(g0[0], ns, divisions)
                and _is_plain_quarter_group(g1[0], ns, divisions)
                and _is_plain_eighth_group(g2[0], ns, divisions)
            ):
                continue
            _halve_group_to_eighth(g0[1], ns)
            _halve_group_to_eighth(g1[1], ns)
            _rebeam_group(g0[1], ns, "begin")
            _rebeam_group(g1[1], ns, "end")
            fixed += 1
            break
    return fixed


def _repair_two_quarter_voice_as_eighths(
    measure: ET.Element, ns: str, divisions: int, expected: int
) -> int:
    """voice 전체가 plain 4분 2개뿐이고 마디가 4분 하나 분량 초과일 때 8분 2개로."""
    if not divisions or not expected:
        return 0
    eighth = divisions // 2
    fixed = 0
    for (_, _voice), groups in _voice_groups(measure, ns).items():
        if len(groups) != 2:
            continue
        if not (
            _is_plain_quarter_group(groups[0][0], ns, divisions)
            and _is_plain_quarter_group(groups[1][0], ns, divisions)
        ):
            continue
        total = sum(_note_duration(g[0], ns) or 0 for g in groups)
        if total != expected + divisions:
            continue
        _halve_group_to_eighth(groups[0][1], ns)
        _halve_group_to_eighth(groups[1][1], ns)
        _rebeam_group(groups[0][1], ns, "begin")
        _rebeam_group(groups[1][1], ns, "end")
        fixed += 1
    return fixed


def _note_has_staccato(note: ET.Element, ns: str) -> bool:
    for notations in note.findall(qname(ns, "notations")):
        for arts in notations.findall(qname(ns, "articulations")):
            if any(local_tag(a) == "staccato" for a in arts):
                return True
    return False


def _repair_three_eighths_as_triplet(
    measure: ET.Element, ns: str, max_staff: int, divisions: int
) -> int:
    """연속 plain 8분 3개 + staccato(잇단 '3' 오인) → 세잇단."""
    if not divisions:
        return 0
    eighth = divisions // 2
    triplet_dur = max(1, (eighth * 2) // 3)
    fixed = 0
    for (_, _voice), groups in _voice_groups(measure, ns).items():
        for i in range(len(groups) - 2):
            trio = groups[i : i + 3]
            if any(
                g[0].find(qname(ns, "time-modification")) is not None
                or g[0].find(qname(ns, "dot")) is not None
                or _is_rest(g[0], ns)
                for g in trio
            ):
                continue
            if not all(_note_duration(g[0], ns) == eighth for g in trio):
                continue
            if not any(_note_has_staccato(n, ns) for g in trio for n in g[1]):
                continue
            for j, grp in enumerate(trio):
                for n in grp[1]:
                    _clear_note_staccato(n, ns)
                    _strip_tuplet_notations(n, ns)
                    _ensure_time_modification(n, ns)
                    _set_note_type_duration(n, ns, triplet_dur, "eighth")
                    _rebeam_group(
                        [n], ns, "begin" if j == 0 else ("end" if j == 2 else "continue")
                    )
            plc = _infer_tuplet_placement(trio[0][0], ns, max_staff)
            _ensure_tuplet_bracket(trio[0][0], ns, plc, trio[2][0])
            fixed += 1
            break
    return fixed


def _normalize_overfull_rest_only_voice(groups: list, ns: str, expected: int) -> bool:
    """온쉼표 한 개뿐인데 duration이 마디 길이를 넘는 경우 정규화."""
    if len(groups) != 1:
        return False
    leader, notes, _, _ = groups[0]
    if not _is_rest(leader, ns) or len(notes) != 1:
        return False
    typ = _note_type_text(leader, ns)
    if typ not in (None, "whole"):
        return False
    dur = _note_duration(leader, ns)
    if dur is None or dur <= expected:
        return False
    d = leader.find(qname(ns, "duration"))
    d.text = str(expected)
    return True


def _repair_overfull_eighth(part: ET.Element, ns: str) -> tuple[int, int]:
    """(staff, voice)가 8분음표 하나만큼 넘칠 때, 오인된 4분음표 하나를 8분음표로 복원."""
    fixed = 0
    rest_fixed = 0
    for measure, divisions, expected in _iter_measures_with_timing(part, ns):
        if not divisions or not expected:
            continue
        eighth = divisions // 2
        if eighth <= 0:
            continue
        for (_, _voice), groups in _voice_groups(measure, ns).items():
            total = 0
            for leader, _, _, _ in groups:
                dur = _note_duration(leader, ns)
                if dur is not None:
                    total += dur
            if total == expected:
                continue
            if _normalize_overfull_rest_only_voice(groups, ns, expected):
                rest_fixed += 1
                continue
            if total != expected + eighth:
                continue
            # 후보: 점·잇단 없음, 순수 4분음표(쉼표 제외)
            candidates: list[tuple[int, int]] = []  # (index, score)
            for i, (leader, _, _, _) in enumerate(groups):
                if _is_rest(leader, ns):
                    continue
                if _note_type_text(leader, ns) != "quarter":
                    continue
                if leader.find(qname(ns, "dot")) is not None:
                    continue
                if leader.find(qname(ns, "time-modification")) is not None:
                    continue
                if _note_duration(leader, ns) != divisions:
                    continue
                score = 0
                prev = groups[i - 1][0] if i > 0 else None
                if prev is not None and prev.find(qname(ns, "dot")) is not None:
                    score += 4  # ♩. ♪ 패턴의 두번째 음
                if i == len(groups) - 1 and prev is not None and _is_rest(prev, ns):
                    score += 3  # 쉼표 뒤 마지막 못갖춘 8분음표
                if i == 1 and _is_rest(groups[0][0], ns) and _note_duration(groups[0][0], ns) == eighth:
                    score += 3  # 마디 시작 8분쉼표 직후 첫 음
                candidates.append((i, score))
            if not candidates:
                continue
            if len(candidates) == 1:
                pick = candidates[0][0]
            else:
                candidates.sort(key=lambda c: c[1], reverse=True)
                if candidates[0][1] == 0 or candidates[0][1] == candidates[1][1]:
                    continue  # 근거 불충분 — 건드리지 않음
                pick = candidates[0][0]
            _halve_group_to_eighth(groups[pick][1], ns)
            fixed += 1
    return fixed, rest_fixed


def _ensure_time_modification(note: ET.Element, ns: str, actual: int = 3, normal: int = 2) -> None:
    tm = note.find(qname(ns, "time-modification"))
    if tm is None:
        dur_el = note.find(qname(ns, "duration"))
        idx = list(note).index(dur_el) + 1 if dur_el is not None else len(note)
        tm = ET.Element(qname(ns, "time-modification"))
        note.insert(idx, tm)
    an = tm.find(qname(ns, "actual-notes"))
    if an is None:
        an = ET.SubElement(tm, qname(ns, "actual-notes"))
    an.text = str(actual)
    nn = tm.find(qname(ns, "normal-notes"))
    if nn is None:
        nn = ET.SubElement(tm, qname(ns, "normal-notes"))
    nn.text = str(normal)


def _set_note_type_duration(note: ET.Element, ns: str, duration: int, note_type: str) -> None:
    d = note.find(qname(ns, "duration"))
    if d is not None:
        d.text = str(duration)
    t = note.find(qname(ns, "type"))
    if t is not None:
        t.text = note_type


def _copy_pitch_alter(src: ET.Element, dst: ET.Element, ns: str) -> None:
    sp = src.find(qname(ns, "pitch"))
    dp = dst.find(qname(ns, "pitch"))
    if sp is None or dp is None:
        return
    sa = sp.find(qname(ns, "alter"))
    if sa is None or not sa.text:
        return
    da = dp.find(qname(ns, "alter"))
    if da is None:
        da = ET.SubElement(dp, qname(ns, "alter"))
    da.text = sa.text
    try:
        alter_val = int(float(sa.text))
    except ValueError:
        return
    acc = dst.find(qname(ns, "accidental"))
    if acc is not None:
        dst.remove(acc)
    if alter_val == 1:
        ET.SubElement(dst, qname(ns, "accidental")).text = "sharp"
    elif alter_val == -1:
        ET.SubElement(dst, qname(ns, "accidental")).text = "flat"


def _clear_note_staccato(note: ET.Element, ns: str) -> None:
    for notations in list(note.findall(qname(ns, "notations"))):
        for arts in list(notations.findall(qname(ns, "articulations"))):
            for art in list(arts):
                if local_tag(art) == "staccato":
                    arts.remove(art)
            if len(arts) == 0:
                notations.remove(arts)


def _set_beam(note: ET.Element, ns: str, value: str | None) -> None:
    for b in list(note.findall(qname(ns, "beam"))):
        note.remove(b)
    if value and note.find(qname(ns, "rest")) is None:
        ET.SubElement(note, qname(ns, "beam"), {"number": "1"}).text = value


def _strip_tuplet_notations(note: ET.Element, ns: str) -> None:
    for notations in list(note.findall(qname(ns, "notations"))):
        for t in list(notations.findall(qname(ns, "tuplet"))):
            notations.remove(t)
        if len(notations) == 0:
            note.remove(notations)


def _ensure_tuplet_bracket(leader: ET.Element, ns: str, placement: str, stop_leader: ET.Element) -> None:
    _strip_tuplet_notations(leader, ns)
    _strip_tuplet_notations(stop_leader, ns)
    notations = leader.find(qname(ns, "notations"))
    if notations is None:
        notations = ET.SubElement(leader, qname(ns, "notations"))
    ET.SubElement(
        notations,
        qname(ns, "tuplet"),
        {"type": "start", "show-number": "actual", "placement": placement},
    )
    stop_n = stop_leader.find(qname(ns, "notations"))
    if stop_n is None:
        stop_n = ET.SubElement(stop_leader, qname(ns, "notations"))
    for t in list(stop_n.findall(qname(ns, "tuplet"))):
        if t.get("type") == "stop":
            stop_n.remove(t)
    ET.SubElement(stop_n, qname(ns, "tuplet"), {"type": "stop"})


def _consolidate_cross_voices_on_staff(measure: ET.Element, ns: str) -> int:
    """backup/forward로 같은 staff에서 겹치게 들어온 보조 voice를 주 voice에 병합."""
    merged = 0
    while True:
        children = list(measure)
        found = False
        for i, el in enumerate(children):
            if local_tag(el) != "backup":
                continue
            if i + 1 >= len(children) or local_tag(children[i + 1]) != "forward":
                continue
            j = i + 2
            first_sec = None
            while j < len(children):
                if local_tag(children[j]) == "note":
                    first_sec = children[j]
                    break
                if local_tag(children[j]) in ("backup", "forward"):
                    break
                j += 1
            if first_sec is None:
                continue
            sec_voice, sec_staff = _note_voice_staff(first_sec, ns)
            if not sec_voice or not sec_staff:
                continue
            pri_voice = None
            for k in range(i - 1, -1, -1):
                if local_tag(children[k]) == "note":
                    v, s = _note_voice_staff(children[k], ns)
                    if s == sec_staff and v and v != sec_voice:
                        pri_voice = v
                        break
                if local_tag(children[k]) in ("backup", "forward"):
                    break
            if not pri_voice:
                continue
            measure.remove(el)
            measure.remove(children[i + 1])
            for note in measure.findall(qname(ns, "note")):
                v, s = _note_voice_staff(note, ns)
                if v == sec_voice and s == sec_staff:
                    vel = note.find(qname(ns, "voice"))
                    if vel is not None:
                        vel.text = pri_voice
            merged += 1
            found = True
            break
        if not found:
            break
    return merged


def _repair_two_quarters_as_triplet_prefix(measure: ET.Element, ns: str, max_staff: int) -> int:
    """4분 2개 + 세잇단 8분 연속 — 앞 4분 2개를 첫 세잇단 1·2음으로 복원.

    Audiveris가 세잇단 선두 8분 2개를 4분으로 오인한 패턴(피아노 LH 등).
    마디 voice 선두에서만 적용하며, 이어지는 8분은 모두 time-modification=dur4여야 한다.
    """
    fixed = 0
    for (_, _voice), groups in _voice_groups(measure, ns).items():
        if len(groups) < 5:
            continue
        g0, g1 = groups[0], groups[1]
        if _note_duration(g0[0], ns) != 12 or _note_duration(g1[0], ns) != 12:
            continue
        if g0[0].find(qname(ns, "time-modification")) is not None:
            continue
        if g1[0].find(qname(ns, "time-modification")) is not None:
            continue
        if g0[0].find(qname(ns, "dot")) or g1[0].find(qname(ns, "dot")):
            continue
        tail = groups[2:]
        if not tail or tail[0][0].find(qname(ns, "time-modification")) is None:
            continue
        if not all(
            _note_duration(g[0], ns) == 4
            and g[0].find(qname(ns, "time-modification")) is not None
            for g in tail
        ):
            continue

        for gi, grp in enumerate((g0, g1)):
            for n in grp[1]:
                _clear_note_staccato(n, ns)
                _ensure_time_modification(n, ns)
                _set_note_type_duration(n, ns, 4, "eighth")
                _set_beam(n, ns, "begin" if gi == 0 else "continue")
        for n in groups[2][1]:
            _clear_note_staccato(n, ns)
            _strip_tuplet_notations(n, ns)
            _set_beam(n, ns, "end")
        for grp in (g0, g1, groups[2]):
            for n in grp[1]:
                _strip_tuplet_notations(n, ns)
        plc = _infer_tuplet_placement(g0[0], ns, max_staff)
        _ensure_tuplet_bracket(g0[0], ns, plc, groups[2][0])

        fixed += 1
    return fixed


def _has_tuplet_element(note: ET.Element, ns: str) -> bool:
    for notations in note.findall(qname(ns, "notations")):
        if notations.findall(qname(ns, "tuplet")):
            return True
    return False


def _add_tuplet_element(
    note: ET.Element, ns: str, tuplet_type: str, placement: str | None = None
) -> None:
    notations = note.find(qname(ns, "notations"))
    if notations is None:
        notations = ET.SubElement(note, qname(ns, "notations"))
    attrib = {"type": tuplet_type}
    if tuplet_type == "start":
        attrib["show-number"] = "actual"
        if placement:
            attrib["placement"] = placement
    ET.SubElement(notations, qname(ns, "tuplet"), attrib=attrib)


def _ensure_tuplet_notations(part: ET.Element, ns: str, max_staff: int = 1) -> int:
    """time-modification만 있고 tuplet 표기가 없는 잇단 묶음에 '3' 표기 주입.

    MuseScore는 time-modification만으로도 잇단 숫자를 그리지만, OSMD는
    tuplet 요소가 없으면 숫자를 그리지 않아 미리보기에서 '3'이 사라져 보인다.
    같은 staff/voice의 연속 잇단 묶음이 박(divisions) 배수로 나누어떨어지는
    지점마다 tuplet start/stop(show-number=actual, 빔 쪽 placement)을 넣는다.
    """
    added = 0
    for measure, divisions, _expected in _iter_measures_with_timing(part, ns):
        if not divisions:
            continue
        by_key: dict[tuple[str, str], list] = {}
        for grp in _iter_chord_groups(measure, ns):
            by_key.setdefault((grp[2], grp[3]), []).append(grp)
        for glist in by_key.values():
            run: list = []
            run_dur = 0
            for grp in glist:
                leader = grp[0]
                if leader.find(qname(ns, "time-modification")) is None or _has_tuplet_element(
                    leader, ns
                ):
                    run, run_dur = [], 0
                    continue
                dur = _note_duration(leader, ns)
                if dur is None or dur <= 0:
                    run, run_dur = [], 0
                    continue
                run.append(grp)
                run_dur += dur
                if run_dur % divisions == 0:
                    if len(run) >= 2:
                        placement = _infer_tuplet_placement(run[0][0], ns, max_staff)
                        _add_tuplet_element(run[0][0], ns, "start", placement)
                        _add_tuplet_element(run[-1][0], ns, "stop")
                        added += 1
                    run, run_dur = [], 0
            # 박 경계에 못 미친 미완 묶음은 건드리지 않음
    return added


def _remove_spurious_tuplet_dynamics(part: ET.Element, ns: str) -> int:
    """피아노(2단) 파트의 잇단 마디에서 단독 `p` dynamics 제거.

    Audiveris가 잇단 숫자 '3'을 dynamics `p`로 오인하는 사례('눈/김효근' 보고).
    잇단(time-modification) 음표가 있는 마디에서, direction-type 내용이
    dynamics `p` 하나뿐인 direction만 제거한다 (pp·mp·f 등은 보존).
    """
    removed = 0
    for measure in part.findall(qname(ns, "measure")):
        if not any(
            n.find(qname(ns, "time-modification")) is not None
            for n in measure.findall(qname(ns, "note"))
        ):
            continue
        for direction in list(measure.findall(qname(ns, "direction"))):
            dts = direction.findall(qname(ns, "direction-type"))
            if not dts:
                continue
            saw_p = False
            only_p = True
            for dt in dts:
                for child in dt:
                    if local_tag(child) != "dynamics":
                        only_p = False
                        break
                    if [local_tag(c) for c in child] != ["p"]:
                        only_p = False
                        break
                    saw_p = True
                if not only_p:
                    break
            if saw_p and only_p:
                measure.remove(direction)
                removed += 1
    return removed


def _group_pitch_map(notes: list[ET.Element], ns: str) -> dict[str, ET.Element]:
    out: dict[str, ET.Element] = {}
    for n in notes:
        label = _pitch_label(n, ns)
        if label:
            out.setdefault(label, n)
    return out


def _note_has_tie(note: ET.Element, ns: str, tie_type: str) -> bool:
    return any(t.get("type") == tie_type for t in note.findall(qname(ns, "tie")))


def _add_tie(note: ET.Element, ns: str, tie_type: str) -> None:
    if not _note_has_tie(note, ns, tie_type):
        tie = ET.Element(qname(ns, "tie"), attrib={"type": tie_type})
        dur_idx = None
        for idx, child in enumerate(note):
            if local_tag(child) == "duration":
                dur_idx = idx
        note.insert(dur_idx + 1 if dur_idx is not None else len(note), tie)
    notations = note.find(qname(ns, "notations"))
    if notations is None:
        notations = ET.SubElement(note, qname(ns, "notations"))
    if not any(t.get("type") == tie_type for t in notations.findall(qname(ns, "tied"))):
        ET.SubElement(notations, qname(ns, "tied"), attrib={"type": tie_type})


def _measure_starts_new_system(measure: ET.Element, ns: str) -> bool:
    for pr in measure.findall(qname(ns, "print")):
        if pr.get("new-system") == "yes" or pr.get("new-page") == "yes":
            return True
    return False


def _restore_ties_between_measures(part: ET.Element, ns: str) -> tuple[int, int]:
    """인접 마디 사이 tie 보완.

    1) 화음 일부에만 tie가 남은 경우 — 양쪽 화음에 공통 피치가 더 있으면 tie 확장.
    2) 줄바꿈(new-system) 경계에서 동일 화음(2음 이상)이 이어지고 앞 음이 더 길면 tie 복원.
    """
    completed = 0
    system_added = 0
    measures = part.findall(qname(ns, "measure"))
    for mi in range(len(measures) - 1):
        cur, nxt = measures[mi], measures[mi + 1]
        cur_by_voice = _voice_groups(cur, ns)
        nxt_by_voice = _voice_groups(nxt, ns)
        for key, cur_groups in cur_by_voice.items():
            nxt_groups = nxt_by_voice.get(key)
            if not cur_groups or not nxt_groups:
                continue
            a_notes = cur_groups[-1][1]
            b_notes = nxt_groups[0][1]
            a_map = _group_pitch_map(a_notes, ns)
            b_map = _group_pitch_map(b_notes, ns)
            common = [p for p in a_map if p in b_map]
            if not common:
                continue
            tied_pairs = [
                p
                for p in common
                if _note_has_tie(a_map[p], ns, "start") and _note_has_tie(b_map[p], ns, "stop")
            ]
            if tied_pairs:
                for p in common:
                    if p in tied_pairs:
                        continue
                    if _note_has_tie(a_map[p], ns, "start") or _note_has_tie(b_map[p], ns, "stop"):
                        continue
                    _add_tie(a_map[p], ns, "start")
                    _add_tie(b_map[p], ns, "stop")
                    completed += 1
                continue
            if not _measure_starts_new_system(nxt, ns):
                continue
            if len(a_map) < 2 or set(a_map) != set(b_map):
                continue
            if any(_note_has_tie(n, ns, "start") for n in a_notes):
                continue
            dur_a = _note_duration(cur_groups[-1][0], ns)
            dur_b = _note_duration(nxt_groups[0][0], ns)
            if dur_a is None or dur_b is None or dur_a <= dur_b:
                continue
            for p in a_map:
                _add_tie(a_map[p], ns, "start")
                _add_tie(b_map[p], ns, "stop")
            system_added += 1
    return completed, system_added


def fix_score_xml(xml_bytes: bytes) -> tuple[bytes, dict[str, int]]:
    tree = ET.parse(io.BytesIO(xml_bytes))
    root = tree.getroot()
    ns = mxl_ns_uri(root)
    parents = _parent_map(root)
    stats = {
        "text_nodes_cleared": 0,
        "directions_removed": 0,
        "natural_from_staccato_removed": 0,
        "slurs_injected": 0,
        "tuplet_show_number_fixed": 0,
        "tuplet_staccato_removed": 0,
        "tuplet_notations_added": 0,
        "tuplet_dynamics_removed": 0,
        "score_patches_applied": 0,
        "overfull_eighth_fixed": 0,
        "overfull_rest_normalized": 0,
        "dotted_quarter_eighth_fixed": 0,
        "lost_eighth_restored": 0,
        "chord_ties_completed": 0,
        "system_break_ties_added": 0,
        "voice_consolidated": 0,
        "triplet_quarter_prefix_repaired": 0,
        "chord_duplicates_removed": 0,
        "misread_natural_to_sharp": 0,
        "quarter_pair_eighth_fixed": 0,
        "two_quarter_voice_eighth_fixed": 0,
        "three_eighth_triplet_fixed": 0,
    }

    # 1) 텍스트 정리 + backup/forward 겹침 voice 병합 (악보 패치보다 먼저)
    for part in root.findall(qname(ns, "part")):
        for measure in part.findall(qname(ns, "measure")):
            tc, dr = _clean_measure(measure, ns, parents)
            stats["text_nodes_cleared"] += tc
            stats["directions_removed"] += dr
            stats["voice_consolidated"] += _consolidate_cross_voices_on_staff(measure, ns)

    # 2) 범용 리듬·화음·세잇단 보정
    for part in root.findall(qname(ns, "part")):
        max_staff = _max_staff_in_part(part, ns)
        for measure, divisions, expected in _iter_measures_with_timing(part, ns):
            stats["chord_duplicates_removed"] += _dedupe_chord_members_in_measure(measure, ns)
            stats["quarter_pair_eighth_fixed"] += _repair_quarter_pair_before_eighths(
                measure, ns, divisions or 0
            )
            stats["two_quarter_voice_eighth_fixed"] += _repair_two_quarter_voice_as_eighths(
                measure, ns, divisions or 0, expected or 0
            )
            stats["three_eighth_triplet_fixed"] += _repair_three_eighths_as_triplet(
                measure, ns, max_staff, divisions or 0
            )
        for measure in part.findall(qname(ns, "measure")):
            stats["triplet_quarter_prefix_repaired"] += _repair_two_quarters_as_triplet_prefix(
                measure, ns, max_staff
            )

        dotted_fixed, lost_eighth = _repair_dotted_quarter_misread(part, ns)
        stats["dotted_quarter_eighth_fixed"] += dotted_fixed
        stats["lost_eighth_restored"] += lost_eighth

        fixed, rest_fixed = _repair_overfull_eighth(part, ns)
        stats["overfull_eighth_fixed"] += fixed
        stats["overfull_rest_normalized"] += rest_fixed

    # 3) 음표 발명·성부 재배치 등 최후 수단 패치 (시그니처 일치 시만)
    try:
        from omr_score_patches import apply_score_patches

        stats["score_patches_applied"] = apply_score_patches(root, ns)
    except ImportError:
        pass

    for part in root.findall(qname(ns, "part")):
        max_staff = _max_staff_in_part(part, ns)

        stats["tuplet_notations_added"] += _ensure_tuplet_notations(part, ns, max_staff)
        if _part_has_two_staves(part, ns):
            stats["tuplet_dynamics_removed"] += _remove_spurious_tuplet_dynamics(part, ns)

        for note in part.iter(qname(ns, "note")):
            if _remove_duplicate_staccato_as_natural(note, ns):
                stats["natural_from_staccato_removed"] += 1
            if _fix_misread_natural_as_sharp(note, ns):
                stats["misread_natural_to_sharp"] += 1
            if _remove_beam_side_staccato_on_tuplet(note, ns):
                stats["tuplet_staccato_removed"] += 1
            if _fix_tuplet_show_numbers(note, ns, max_staff):
                stats["tuplet_show_number_fixed"] += 1

        completed, system_added = _restore_ties_between_measures(part, ns)
        stats["chord_ties_completed"] += completed
        stats["system_break_ties_added"] += system_added

        if _part_is_piano(part.get("id"), root, ns) or _part_has_two_staves(part, ns):
            stats["slurs_injected"] += _inject_missing_slurs_piano_m6(part, ns)

    out = ET.tostring(root, encoding="UTF-8", xml_declaration=True)
    return out, stats


def fix_mxl_file(mxl_in: str | Path, mxl_out: str | Path) -> dict[str, int]:
    mxl_in = Path(mxl_in)
    mxl_out = Path(mxl_out)
    totals = {
        "text_nodes_cleared": 0,
        "directions_removed": 0,
        "natural_from_staccato_removed": 0,
        "slurs_injected": 0,
        "tuplet_show_number_fixed": 0,
        "tuplet_staccato_removed": 0,
    }

    with zipfile.ZipFile(mxl_in, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    container_xml = files.get("META-INF/container.xml")
    if not container_xml:
        raise ValueError("Invalid MXL: no container.xml")

    match = re.search(r'full-path="([^"]+)"', container_xml.decode("utf-8"))
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


def fix_mxl_path_inplace(mxl_path: str | Path) -> dict[str, int]:
    """MXL 파일을 제자리에서 후처리 (Audiveris 직후·OMR 검토용)."""
    import os
    import shutil
    import tempfile

    mxl_path = Path(mxl_path)
    fd, tmp = tempfile.mkstemp(suffix=".mxl")
    os.close(fd)
    try:
        stats = fix_mxl_file(mxl_path, tmp)
        shutil.copyfile(tmp, mxl_path)
        return stats
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python fix_audiveris_mxl.py <mxl_in> [mxl_out]", file=sys.stderr)
        return 2
    if len(sys.argv) == 2:
        import json

        stats = fix_mxl_path_inplace(sys.argv[1])
        print(json.dumps({"path": sys.argv[1], **stats}, ensure_ascii=False))
        return 0
    stats = fix_mxl_file(sys.argv[1], sys.argv[2])
    print(
        "fix_audiveris_mxl: " + " ".join(f"{k}={v}" for k, v in sorted(stats.items())),
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
