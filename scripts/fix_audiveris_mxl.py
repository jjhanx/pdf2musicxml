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


def _pitch_midi(note: ET.Element, ns: str) -> int:
    pitch_el = note.find(qname(ns, "pitch"))
    if pitch_el is None:
        return -999999
    step_el = pitch_el.find(qname(ns, "step"))
    oct_el = pitch_el.find(qname(ns, "octave"))
    if step_el is None or oct_el is None or not step_el.text or not oct_el.text:
        return -999999
    steps = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
    alter = 0
    alter_el = pitch_el.find(qname(ns, "alter"))
    if alter_el is not None and alter_el.text:
        try:
            alter = int(float(alter_el.text.strip()))
        except ValueError:
            alter = 0
    return (int(oct_el.text.strip()) + 1) * 12 + steps.get(step_el.text.strip(), 0) + alter


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


def _notehead_slur_placement(note: ET.Element, ns: str) -> str:
    """이음줄을 음머리 쪽에 그리도록 placement — stem up→below, stem down→above."""
    stem = note.find(qname(ns, "stem"))
    if stem is not None and (stem.text or "").strip() == "down":
        return "above"
    return "below"


def _lower_chord_member(members: list[ET.Element], ns: str) -> ET.Element:
    labeled = [n for n in members if _pitch_label(n, ns)]
    if not labeled:
        return members[0]
    return min(labeled, key=lambda n: _pitch_midi(n, ns))


def _upper_chord_member(members: list[ET.Element], ns: str) -> ET.Element:
    labeled = [n for n in members if _pitch_label(n, ns)]
    if not labeled:
        return members[0]
    return max(labeled, key=lambda n: _pitch_midi(n, ns))


def _chord_member_slur_placement(
    note: ET.Element, chord_members: list[ET.Element], ns: str
) -> str:
    return _notehead_slur_placement(note, ns)


def _apply_slur_orientation(slur: ET.Element, note: ET.Element, ns: str) -> None:
    """OSMD: orientation 제거. default-y는 음머리 쪽 오프셋용으로만 유지."""
    slur.attrib.pop("orientation", None)


def _set_slur_notehead_offset(
    slur: ET.Element, note: ET.Element, ns: str, placement: str
) -> None:
    """이음줄을 깃대가 아닌 음머리 쪽으로 — stem up: below는 더 아래, above는 윗성부 쪽."""
    stem = _stem_direction(note, ns)
    if placement == "below":
        slur.set("default-y", "-35" if stem == "up" else "-25")
    elif placement == "above":
        slur.set("default-y", "35" if stem == "up" else "25")


def _add_slur_to_note(
    note_el: ET.Element,
    ns: str,
    slur_type: str,
    slur_num: int,
    *,
    placement: str | None = None,
    chord_members: list[ET.Element] | None = None,
) -> bool:
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
    plc = placement
    if plc is None and chord_members is not None:
        plc = _chord_member_slur_placement(note_el, chord_members, ns)
    elif plc is None:
        plc = _notehead_slur_placement(note_el, ns)
    if plc is not None:
        slur.set("placement", plc)
    _apply_slur_orientation(slur, note_el, ns)
    if plc is not None:
        _set_slur_notehead_offset(slur, note_el, ns, plc)
    notations.append(slur)
    return True


def _normalize_slur_placements(part: ET.Element, ns: str) -> int:
    """화음 2성부 slur — 아래 음(E4) below, 위 음(G4) above (음머리 높이)."""
    fixed = 0
    for measure in part.findall(qname(ns, "measure")):
        for grp in _iter_chord_groups(measure, ns):
            members = grp[1]
            if len(members) < 2:
                continue
            lower = _lower_chord_member(members, ns)
            upper = _upper_chord_member(members, ns)
            starts: list[tuple[ET.Element, ET.Element, ET.Element]] = []
            stops: list[tuple[ET.Element, ET.Element, ET.Element]] = []
            for n in members:
                for slur in n.findall(".//" + qname(ns, "slur")):
                    st = slur.get("type")
                    num = slur.get("number") or "1"
                    try:
                        num_i = int(num)
                    except ValueError:
                        num_i = 1
                    target = lower if num_i % 2 == 0 else upper
                    if num_i % 2 == 0:
                        want_plc = "below"
                    else:
                        want_plc = "above"
                    if st == "start":
                        starts.append((n, slur, target))
                    elif st == "stop":
                        stops.append((n, slur, target))
            for n, slur, target in starts + stops:
                if n is target:
                    plc = "below" if target is lower else "above"
                    if slur.get("placement") != plc:
                        slur.set("placement", plc)
                        fixed += 1
                    _apply_slur_orientation(slur, target, ns)
                    _set_slur_notehead_offset(slur, target, ns, plc)
                    continue
                notations = n.find(qname(ns, "notations"))
                if notations is not None:
                    notations.remove(slur)
                    fixed += 1
                tgt_notations = target.find(qname(ns, "notations"))
                if tgt_notations is None:
                    tgt_notations = ET.Element(qname(ns, "notations"))
                    target.append(tgt_notations)
                if slur not in list(tgt_notations):
                    tgt_notations.append(slur)
                    fixed += 1
                plc = "below" if target is lower else "above"
                if slur.get("placement") != plc:
                    slur.set("placement", plc)
                    fixed += 1
                _apply_slur_orientation(slur, target, ns)
                plc_on_slur = slur.get("placement")
                if plc_on_slur:
                    _set_slur_notehead_offset(slur, target, ns, plc_on_slur)
    return fixed


def _default_stem_for_staff(staff: str, max_staff: int) -> str:
    if max_staff >= 2 and staff == "2":
        return "down"
    return "up"


def _ensure_stem_for_staff(
    note: ET.Element, staff: str, max_staff: int, ns: str
) -> bool:
    """빔·세잇단 XML에 stem 요소가 없을 때만 staff 기본값을 채움. Audiveris stem은 유지."""
    stem_el = note.find(qname(ns, "stem"))
    if stem_el is not None and (stem_el.text or "").strip():
        return False
    want = _default_stem_for_staff(staff or "1", max_staff)
    if stem_el is None:
        stem_el = ET.SubElement(note, qname(ns, "stem"))
    stem_el.text = want
    return True


def _stem_from_note(note: ET.Element, ns: str) -> str | None:
    stem_el = note.find(qname(ns, "stem"))
    if stem_el is None or not (stem_el.text or "").strip():
        return None
    return (stem_el.text or "").strip()


def _ensure_stem_like_reference(
    note: ET.Element,
    staff: str,
    max_staff: int,
    ns: str,
    reference: ET.Element | None,
) -> bool:
    """참조 음표 stem 방향을 따르거나, 없으면 staff 기본값."""
    ref = _stem_from_note(reference, ns) if reference is not None else None
    want = ref or _default_stem_for_staff(staff or "1", max_staff)
    stem_el = note.find(qname(ns, "stem"))
    if stem_el is None:
        stem_el = ET.SubElement(note, qname(ns, "stem"))
        stem_el.text = want
        return True
    if (stem_el.text or "").strip() != want:
        stem_el.text = want
        return True
    return False


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


def _infer_tuplet_placement(note_or_run, ns: str, max_staff: int) -> str:
    """세잇단 숫자 placement — 빔 쪽(stem down → below, stem up → above)."""
    notes = [note_or_run] if isinstance(note_or_run, ET.Element) else note_or_run
    for n in notes:
        if not _is_rest(n, ns):
            stem = _stem_direction(n, ns)
            if stem == "down":
                return "below"
            if stem == "up":
                return "above"
    return "above"


def _tuplet_run_has_rest(measure: ET.Element, start_note: ET.Element, ns: str) -> bool:
    """잇단 start~stop 구간에 쉼표가 있으면 True (쉼표 포함 잇단은 bracket 유지)."""
    voice, staff = _note_voice_staff(start_note, ns)
    if _is_rest(start_note, ns):
        return True
    in_run = False
    for grp in _iter_chord_groups(measure, ns):
        leader = grp[0]
        if leader is start_note:
            in_run = True
        if not in_run:
            continue
        if (grp[2], grp[3]) != (staff or "1", voice or "1"):
            continue
        if _is_rest(leader, ns):
            return True
        for notations in leader.findall(qname(ns, "notations")):
            for tuplet in notations.findall(qname(ns, "tuplet")):
                if tuplet.get("type") == "stop":
                    return False
    return False


def _set_tuplet_bracket_attrs(
    tuplet: ET.Element, has_rest: bool, placement: str | None = None
) -> None:
    """쉼표 없는 잇단: 숫자 '3'만(show-bracket=no). 쉼표 포함: bracket 유지."""
    tuplet.set("show-number", "actual")
    if has_rest:
        tuplet.set("show-bracket", "yes")
        tuplet.set("bracket", "yes")
        if placement:
            tuplet.set("placement", placement)
    else:
        tuplet.set("show-bracket", "no")
        tuplet.set("bracket", "no")
        if placement:
            tuplet.set("placement", placement)


def _renumber_tuplets_in_measure(measure: ET.Element, ns: str) -> int:
    """한 마디 내에 여러 잇단음표가 있을 때, 1~6 번호를 순환하며 부여해
    MuseScore 렌더링 시 잇단음표가 합쳐지거나 유실되는 버그를 방지합니다."""
    fixed = 0
    tuplet_count = 0
    current_mapping = {}
    
    for note in measure.findall(qname(ns, "note")):
        notations = note.find(qname(ns, "notations"))
        if notations is not None:
            for tuplet in notations.findall(qname(ns, "tuplet")):
                old_num = tuplet.get("number") or "1"
                typ = tuplet.get("type")
                if typ == "start":
                    tuplet_count = (tuplet_count % 6) + 1
                    current_mapping[old_num] = str(tuplet_count)
                    if tuplet.get("number") != str(tuplet_count):
                        tuplet.set("number", str(tuplet_count))
                        fixed += 1
                elif typ == "stop":
                    new_num = current_mapping.get(old_num, "1")
                    if tuplet.get("number") != new_num:
                        tuplet.set("number", new_num)
                        fixed += 1
                    if old_num in current_mapping:
                        del current_mapping[old_num]
    return fixed


def _fix_tuplet_show_numbers(
    note: ET.Element, ns: str, max_staff: int = 1, measure: ET.Element | None = None
) -> bool:
    actual = _tuplet_actual_notes(note, ns)
    if actual is None:
        return False
    changed = False
    for notations in note.findall(qname(ns, "notations")):
        for tuplet in notations.findall(qname(ns, "tuplet")):
            if tuplet.get("type") != "start":
                continue
            has_rest = (
                _tuplet_run_has_rest(measure, note, ns)
                if measure is not None
                else note.find(qname(ns, "rest")) is not None
            )
            placement = None
            if actual == 3 and not has_rest:
                placement = _infer_tuplet_placement(note, ns, max_staff)
            before = (tuplet.get("show-number"), tuplet.get("show-bracket"), tuplet.get("bracket"))
            _set_tuplet_bracket_attrs(tuplet, has_rest, placement)
            after = (tuplet.get("show-number"), tuplet.get("show-bracket"), tuplet.get("bracket"))
            if before != after or (placement and tuplet.get("placement") != placement):
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
            new_d = max(1, int(d.text.strip()) // 2)
            d.text = str(new_d)
        t = n.find(qname(ns, "type"))
        if t is not None:
            t.text = "eighth"


def _set_group_to_plain_eighth(
    notes: list[ET.Element], ns: str, divisions: int
) -> None:
    """4분 오인 화음 → plain 8분(duration=divisions//2)."""
    eighth = divisions // 2
    if eighth <= 0:
        return
    for n in notes:
        _set_note_type_duration(n, ns, eighth, "eighth")
        for dot in list(n.findall(qname(ns, "dot"))):
            n.remove(dot)


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


def _is_quarter_rest_group(leader: ET.Element, ns: str, divisions: int) -> bool:
    return (
        _is_rest(leader, ns)
        and _note_type_text(leader, ns) == "quarter"
        and _note_duration(leader, ns) == divisions
    )


def _voice_backup_after_notes(
    measure: ET.Element, ns: str, staff: str, voice: str
) -> tuple[ET.Element | None, int | None]:
    """동일 staff/voice의 마지막 음표(비-chord leader) 직후 첫 backup."""
    last_leader: ET.Element | None = None
    for el in measure:
        if local_tag(el) != "note":
            continue
        v, s = _note_voice_staff(el, ns)
        if v != voice or s != staff:
            continue
        if el.find(qname(ns, "chord")) is None:
            last_leader = el
    if last_leader is None:
        return None, None
    children = list(measure)
    start = children.index(last_leader) + 1
    for el in children[start:]:
        tag = local_tag(el)
        if tag == "backup":
            d = el.find(qname(ns, "duration"))
            if d is None or not d.text or not d.text.strip().isdigit():
                return el, None
            return el, int(d.text.strip())
        if tag == "note" and el.find(qname(ns, "chord")) is None:
            v, s = _note_voice_staff(el, ns)
            if v == voice and s == staff:
                break
    return None, None


def _other_staff_same_voice_duration_before_backup(
    measure: ET.Element, ns: str, staff: str, voice: str, after_leader: ET.Element
) -> int:
    """after_leader 직후 첫 backup 전, 다른 staff·동일 voice 음표 duration 합."""
    children = list(measure)
    start = children.index(after_leader) + 1
    total = 0
    for el in children[start:]:
        tag = local_tag(el)
        if tag == "backup":
            break
        if tag != "note" or el.find(qname(ns, "chord")) is not None:
            continue
        v, s = _note_voice_staff(el, ns)
        if v == voice and s != staff:
            dur = _note_duration(el, ns)
            if dur:
                total += dur
    return total


def _adjust_voice_backup(measure: ET.Element, ns: str, staff: str, voice: str, new_total: int) -> None:
    """해당 staff/voice 마지막 음표 직후 첫 backup duration을 new_total로 맞춤."""
    backup_el, _ = _voice_backup_after_notes(measure, ns, staff, voice)
    if backup_el is None:
        return
    d = backup_el.find(qname(ns, "duration"))
    if d is not None:
        d.text = str(new_total)


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
                    total == expected + eighth
                    and _is_dotted_quarter_group(g0[0], ns, divisions)
                    and _is_plain_quarter_group(g1[0], ns, divisions)
                    and _is_plain_quarter_group(g2[0], ns, divisions)
                    and (
                        _is_eighth_rest_group(g3[0], ns, divisions)
                        or _is_quarter_rest_group(g3[0], ns, divisions)
                    )
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
                # 패턴 A2: ♩. ♩ ♩ 𝄽8 — 마디 길이는 맞지만 2번째 4분 오인 + 끝 8분 유실
                if (
                    total == expected
                    and _is_dotted_quarter_group(g0[0], ns, divisions)
                    and _is_plain_quarter_group(g1[0], ns, divisions)
                    and _is_plain_quarter_group(g2[0], ns, divisions)
                    and _is_eighth_rest_group(g3[0], ns, divisions)
                ):
                    _halve_group_to_eighth(g1[1], ns)
                    new_note = _clone_as_eighth(g2[0], ns, eighth)
                    v, s = _note_voice_staff(g2[0], ns)
                    if v:
                        ve = new_note.find(qname(ns, "voice"))
                        if ve is None:
                            ve = ET.SubElement(new_note, qname(ns, "voice"))
                        ve.text = v
                    if s:
                        se = new_note.find(qname(ns, "staff"))
                        if se is None:
                            se = ET.SubElement(new_note, qname(ns, "staff"))
                        se.text = s
                    stem = g2[0].find(qname(ns, "stem"))
                    if stem is not None and stem.text:
                        ET.SubElement(new_note, qname(ns, "stem")).text = stem.text
                    _insert_after_note(measure, g2[1][-1], new_note)
                    dotted_fixed += 1
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
            # 패턴 B: ♩. ♩ (피아노 voice1 등, backup 직후 다른 voice) — voice에 4분 2개뿐일 때만
            if len(groups) == 2:
                g0, g1 = groups[0], groups[1]
                total = sum(_note_duration(g[0], ns) or 0 for g in groups)
                if (
                    _is_dotted_quarter_group(g0[0], ns, divisions)
                    and _is_plain_quarter_group(g1[0], ns, divisions)
                    and total == expected + eighth
                ):
                    new_total = total - eighth
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
                    if backup_el is not None and new_total > 0:
                        bd = backup_el.find(qname(ns, "duration"))
                        if (
                            bd is not None
                            and bd.text
                            and int(bd.text.strip()) == total
                        ):
                            _halve_group_to_eighth(g1[1], ns)
                            _adjust_voice_backup(measure, ns, staff, voice, new_total)
                            dotted_fixed += 1
                            continue
            # 패턴 E: ♩. ♩ … + backup — 피아노 cross-voice (backup duration == voice 합)
            if (
                len(groups) >= 2
                and _is_dotted_quarter_group(groups[0][0], ns, divisions)
                and _is_plain_quarter_group(groups[1][0], ns, divisions)
            ):
                total = sum(_note_duration(g[0], ns) or 0 for g in groups)
                _, backup_dur = _voice_backup_after_notes(measure, ns, staff, voice)
                other_staff = _other_staff_same_voice_duration_before_backup(
                    measure, ns, staff, voice, groups[1][0]
                )
                backup_matches = backup_dur is not None and (
                    backup_dur == total
                    or (len(groups) == 2 and backup_dur == total + other_staff)
                )
                if backup_matches:
                    if len(groups) >= 3 and _is_plain_quarter_group(
                        groups[2][0], ns, divisions
                    ):
                        _halve_group_to_eighth(groups[1][1], ns)
                        _adjust_voice_backup(
                            measure, ns, staff, voice, (backup_dur or total) - eighth
                        )
                        dotted_fixed += 1
                        continue
                    if len(groups) >= 3 and _is_plain_eighth_group(
                        groups[2][0], ns, divisions
                    ):
                        _halve_group_to_eighth(groups[1][1], ns)
                        _adjust_voice_backup(
                            measure, ns, staff, voice, (backup_dur or total) - eighth
                        )
                        dotted_fixed += 1
                        continue
                    if len(groups) == 2 and other_staff > 0:
                        _halve_group_to_eighth(groups[1][1], ns)
                        _adjust_voice_backup(
                            measure, ns, staff, voice, (backup_dur or total) - eighth
                        )
                        dotted_fixed += 1
                        continue
            # 신규 패턴 G: ♩. ♩ ♩ ♪ ♪ (총합 초과) -> ♩. ♪ ♩ ♪ ♪ 로 보정
            if len(groups) == 5:
                g0, g1, g2, g3, g4 = groups
                eighth = divisions // 2
                quarter = divisions
                dotted_quarter = quarter + eighth
                if (
                    _note_duration(g0[0], ns) == dotted_quarter
                    and _note_duration(g1[0], ns) == quarter
                    and _note_duration(g2[0], ns) == quarter
                    and _note_duration(g3[0], ns) == eighth
                    and _note_duration(g4[0], ns) == eighth
                ):
                    _halve_group_to_eighth(g1[1], ns)
                    dotted_fixed += 1
                    continue

            # 신규 패턴 F: ♩. ♩ ♩ ♪ ♪ — 8분 하나 넘침, ♩ ♩ 둘 다 ♪ ♪로 바꾸고 끝에 𝄽8 보충
            if len(groups) == 5:
                g0, g1, g2, g3, g4 = groups
                total = sum(_note_duration(g[0], ns) or 0 for g in groups)
                if (
                    total == expected + eighth
                    and _is_dotted_quarter_group(g0[0], ns, divisions)
                    and _is_plain_quarter_group(g1[0], ns, divisions)
                    and _is_plain_quarter_group(g2[0], ns, divisions)
                    and _is_plain_eighth_group(g3[0], ns, divisions)
                    and _is_plain_eighth_group(g4[0], ns, divisions)
                ):
                    _halve_group_to_eighth(g1[1], ns)
                    _halve_group_to_eighth(g2[1], ns)
                    rest = ET.Element(qname(ns, "note"))
                    ET.SubElement(rest, qname(ns, "rest"))
                    ET.SubElement(rest, qname(ns, "duration")).text = str(eighth)
                    v, s = _note_voice_staff(g0[0], ns)
                    if v:
                        ET.SubElement(rest, qname(ns, "voice")).text = v
                    if s:
                        ET.SubElement(rest, qname(ns, "staff")).text = s
                    ET.SubElement(rest, qname(ns, "type")).text = "eighth"
                    _insert_after_note(measure, g4[1][-1], rest)
                    dotted_fixed += 2
                    rest_fixed += 1
                    continue

            # 패턴 D: ♩. … ♩(들) ♪♪ — 8분 하나 넘침, 점4분 뒤 4분 하나를 8분으로
            if _is_dotted_quarter_group(groups[0][0], ns, divisions):
                total = sum(_note_duration(g[0], ns) or 0 for g in groups)
                if total == expected + eighth:
                    for qi in range(2, len(groups)):
                        if not _is_plain_eighth_group(groups[qi][0], ns, divisions):
                            continue
                        quarter_idxs = [
                            j
                            for j in range(1, qi)
                            if _is_plain_quarter_group(groups[j][0], ns, divisions)
                        ]
                        if not quarter_idxs:
                            continue
                        pick = quarter_idxs[0]
                        _halve_group_to_eighth(groups[pick][1], ns)
                        dotted_fixed += 1
                        break
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


def _is_quarter_misread_as_eighth(leader: ET.Element, ns: str, divisions: int) -> bool:
    """4분으로 읽힌 8분(복합박·비표준 duration 포함)."""
    if _is_rest(leader, ns):
        return False
    if leader.find(qname(ns, "time-modification")) is not None:
        return False
    if _note_type_text(leader, ns) != "quarter":
        return False
    eighth = divisions // 2
    if eighth <= 0:
        return False
    dur = _note_duration(leader, ns) or 0
    return dur > eighth


def _clone_group_as_quarter(
    notes: list[ET.Element], ns: str, quarter_dur: int
) -> list[ET.Element]:
    out: list[ET.Element] = []
    for i, n in enumerate(notes):
        c = copy.deepcopy(n)
        if i > 0:
            if c.find(qname(ns, "chord")) is None:
                ET.SubElement(c, qname(ns, "chord"))
        else:
            ch = c.find(qname(ns, "chord"))
            if ch is not None:
                c.remove(ch)
        d = c.find(qname(ns, "duration"))
        if d is not None:
            d.text = str(quarter_dur)
        t = c.find(qname(ns, "type"))
        if t is not None:
            t.text = "quarter"
        for dot in list(c.findall(qname(ns, "dot"))):
            c.remove(dot)
        for b in list(c.findall(qname(ns, "beam"))):
            c.remove(b)
        out.append(c)
    return out


def _insert_notes_after_voice(
    measure: ET.Element, ns: str, staff: str, voice: str, notes: list[ET.Element]
) -> None:
    insert_at = 0
    for i, el in enumerate(measure):
        if local_tag(el) != "note":
            continue
        v, s = _note_voice_staff(el, ns)
        if v == voice and s == staff:
            insert_at = i + 1
    for j, n in enumerate(notes):
        measure.insert(insert_at + j, n)


def _repair_quarter_eighth_quarter_lost_final(
    measure: ET.Element, ns: str, divisions: int, expected: int
) -> int:
    """Q–8–Q(동일 화음) 오인 + 끝 4분 유실 — 앞 두 4분을 8분으로, 마지막 4분 복원.

    Audiveris가 빔 8분 2개+중간 8분+빔 8분 2개+4분 화음을
    4분+8분+4분+8분+8분으로 읽어 마디 total==expected 이지만 4분 하나가 빠진 패턴.
    """
    if not divisions or not expected:
        return 0
    fixed = 0
    for (staff, voice), groups in _voice_groups(measure, ns).items():
        if len(groups) < 5:
            continue
        total = sum(_note_duration(g[0], ns) or 0 for g in groups)
        if total != expected:
            continue
        g0, g1, g2 = groups[0], groups[1], groups[2]
        if not (
            _is_quarter_misread_as_eighth(g0[0], ns, divisions)
            and _is_plain_eighth_group(g1[0], ns, divisions)
            and _is_quarter_misread_as_eighth(g2[0], ns, divisions)
        ):
            continue
        if _chord_pitch_signature(g0, ns) != _chord_pitch_signature(g2, ns):
            continue
        saved = (_note_duration(g0[0], ns) or 0) - (divisions // 2)
        saved += (_note_duration(g2[0], ns) or 0) - (divisions // 2)
        if saved <= 0:
            continue
        _set_group_to_plain_eighth(g0[1], ns, divisions)
        _set_group_to_plain_eighth(g2[1], ns, divisions)
        _rebeam_group(g0[1], ns, "begin")
        _rebeam_group(g1[1], ns, "continue")
        _rebeam_group(g2[1], ns, "end")
        quarter_dur = saved
        new_notes = _clone_group_as_quarter(groups[-1][1], ns, quarter_dur)
        for n in new_notes:
            v_el = n.find(qname(ns, "voice"))
            if v_el is None:
                v_el = ET.SubElement(n, qname(ns, "voice"))
            v_el.text = voice
            s_el = n.find(qname(ns, "staff"))
            if s_el is None:
                s_el = ET.SubElement(n, qname(ns, "staff"))
            s_el.text = staff
        _insert_notes_after_voice(measure, ns, staff, voice, new_notes)
        fixed += 1
        break
    return fixed


def _rebeam_group(notes: list[ET.Element], ns: str, beam: str) -> None:
    for n in notes:
        for b in list(n.findall(qname(ns, "beam"))):
            n.remove(b)
        if n.find(qname(ns, "chord")) is None:
            ET.SubElement(n, qname(ns, "beam"), {"number": "1"}).text = beam


def _note_has_misread_natural(note: ET.Element, ns: str) -> bool:
    acc = note.find(qname(ns, "accidental"))
    if acc is None or (acc.text or "").strip() != "natural":
        return False
    pitch_el = note.find(qname(ns, "pitch"))
    if pitch_el is None:
        return False
    alter_el = pitch_el.find(qname(ns, "alter"))
    return alter_el is None or not (alter_el.text or "").strip()


def _remove_accidental_tag(note: ET.Element, ns: str) -> None:
    acc = note.find(qname(ns, "accidental"))
    if acc is not None:
        note.remove(acc)


def _repair_misplaced_sharp_via_duplicate(measure: ET.Element, ns: str, key_fifths: int) -> int:
    """마디 첫 화음: duplicate pitch + 타 음표 natural → `#`를 duplicate에 sharp.
    Audiveris가 `#` 글리프를 인접 음(G/F 등)에 natural로 붙이고, 동일 pitch를
    중복 출력하는 패턴. dedupe 전에 처리해야 duplicate 단서가 사라지지 않는다.
    중복 해제 시 오독된 accidental 음표의 피치 alter를 조표 기준(expected_alter)으로 보정합니다.
    """
    fixed = 0
    seen_staff: set[str] = set()
    for grp in _iter_chord_groups(measure, ns):
        staff = grp[2]
        if staff in seen_staff or _is_rest(grp[0], ns):
            continue
        seen_staff.add(staff)
        notes = grp[1]
        misread_notes = [n for n in notes if _note_has_misread_natural(n, ns)]
        if not misread_notes:
            continue
        by_label: dict[str, list[ET.Element]] = {}
        for n in notes:
            lab = _pitch_label(n, ns)
            if lab:
                by_label.setdefault(lab, []).append(n)
        dup_sets = [v for v in by_label.values() if len(v) > 1]
        if not dup_sets:
            continue
        dup_notes = dup_sets[0]
        misread = next((n for n in misread_notes if n not in dup_notes), misread_notes[0])
        if misread in dup_notes:
            continue
        leader = notes[0]
        for n in dup_notes[:-1]:
            if n is leader:
                for next_n in notes[1:]:
                    if next_n not in dup_notes[:-1]:
                        chord_tag = next_n.find(qname(ns, "chord"))
                        if chord_tag is not None:
                            next_n.remove(chord_tag)
                        break
            measure.remove(n)
            fixed += 1
        _apply_sharp_to_note(dup_notes[-1], ns)
        
        # Restore the misread note to the expected alter of the key signature
        _remove_accidental_tag(misread, ns)
        pitch_el = misread.find(qname(ns, "pitch"))
        if pitch_el is not None:
            step_el = pitch_el.find(qname(ns, "step"))
            if step_el is not None:
                step = step_el.text
                expected_alter = _step_key_alter(step, key_fifths)
                alter_el = pitch_el.find(qname(ns, "alter"))
                if expected_alter != 0:
                    if alter_el is None:
                        # Insert alter_el after step_el
                        idx = list(pitch_el).index(step_el) + 1
                        alter_el = ET.Element(qname(ns, "alter"))
                        pitch_el.insert(idx, alter_el)
                    alter_el.text = str(expected_alter)
                else:
                    if alter_el is not None:
                        pitch_el.remove(alter_el)
        
        fixed += 1
    return fixed


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
    """(비활성) `#` 오인 natural 복원 — `<accidental>natural</accidental>`는 악보의 제자리표로
    해석하는 경우가 많아 자동 sharp 변환은 오히려 F♮ 등을 F#로 바꾼다."""
    return False


def _repair_quarter_pair_before_eighths(
    measure: ET.Element, ns: str, divisions: int, expected: int
) -> int:
    """연속 4분 2개 + 8분 run — 앞 4분 2개를 빔 8분으로 복원.

    voice가 4분 하나 분량 초과이고, 점4분 뒤가 아닐 때만 적용.
    """
    if not divisions or not expected:
        return 0
    eighth = divisions // 2
    fixed = 0
    for (_, _voice), groups in _voice_groups(measure, ns).items():
        total = sum(_note_duration(g[0], ns) or 0 for g in groups)
        if total != expected + divisions:
            continue
        for i in range(len(groups) - 2):
            g0, g1, g2 = groups[i], groups[i + 1], groups[i + 2]
            if i > 0 and _is_dotted_quarter_group(groups[i - 1][0], ns, divisions):
                continue
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


def _set_group_to_quarter(
    notes: list[ET.Element], ns: str, divisions: int
) -> None:
    quarter = divisions
    if quarter <= 0:
        return
    for n in notes:
        _set_note_type_duration(n, ns, quarter, "quarter")
        for dot in list(n.findall(qname(ns, "dot"))):
            n.remove(dot)
        for b in list(n.findall(qname(ns, "beam"))):
            n.remove(b)


def _repair_swap_leading_qq_with_beamed_pair(
    measure: ET.Element, ns: str, divisions: int, expected: int
) -> int:
    """♩♩–♪♪–♩ 오인 ↔ ♪♪–♩♩–♩ (duration 합 동일) — 인쇄 45 PR(m44 staff1) 등."""
    if not divisions or not expected:
        return 0
    fixed = 0
    for (_, _voice), groups in _voice_groups(measure, ns).items():
        if len(groups) < 5:
            continue
        total = sum(_note_duration(g[0], ns) or 0 for g in groups)
        if total != expected:
            continue
        g0, g1, g2, g3 = groups[0], groups[1], groups[2], groups[3]
        if not (
            _is_plain_quarter_group(g0[0], ns, divisions)
            and _is_plain_quarter_group(g1[0], ns, divisions)
            and _is_plain_eighth_group(g2[0], ns, divisions)
            and _is_plain_eighth_group(g3[0], ns, divisions)
        ):
            continue
        if _note_has_beam(g0[0], ns) or _note_has_beam(g1[0], ns):
            continue
        if not (_note_has_beam(g2[0], ns) and _note_has_beam(g3[0], ns)):
            continue
        _set_group_to_plain_eighth(g0[1], ns, divisions)
        _set_group_to_plain_eighth(g1[1], ns, divisions)
        _rebeam_group(g0[1], ns, "begin")
        _rebeam_group(g1[1], ns, "end")
        _set_group_to_quarter(g2[1], ns, divisions)
        _set_group_to_quarter(g3[1], ns, divisions)
        fixed += 1
        break
    return fixed


def _repair_leading_quarter_pair(
    measure: ET.Element, ns: str, divisions: int, expected: int
) -> int:
    """마디 맨 앞 연속 plain 4분 2개 — 빔 8분 한 쌍으로 읽혀야 할 때 복원.

    Audiveris가 첫 빔 8분 2개를 4분 2개로 읽어 voice가 4분 하나 분량 넘치는 패턴.
    """
    if not divisions or not expected:
        return 0
    fixed = 0
    for (_, _voice), groups in _voice_groups(measure, ns).items():
        if len(groups) < 2:
            continue
        total = sum(_note_duration(g[0], ns) or 0 for g in groups)
        if total != expected + divisions:
            continue
        g0, g1 = groups[0], groups[1]
        if not (
            _is_plain_quarter_group(g0[0], ns, divisions)
            and _is_plain_quarter_group(g1[0], ns, divisions)
        ):
            continue
        if _note_has_beam(g0[0], ns) or _note_has_beam(g1[0], ns):
            continue
        _halve_group_to_eighth(g0[1], ns)
        _halve_group_to_eighth(g1[1], ns)
        _rebeam_group(g0[1], ns, "begin")
        _rebeam_group(g1[1], ns, "end")
        fixed += 1
    return fixed


def _note_has_beam(note: ET.Element, ns: str) -> bool:
    return bool(note.findall(qname(ns, "beam")))


def _repair_quarter_pair_after_beam_run(
    measure: ET.Element, ns: str, divisions: int, expected: int
) -> int:
    """빔 8분 run 뒤 연속 4분 2개(화음) — 각각 8분으로 복원.

    Audiveris가 빔으로 묶인 7~8번째 8분화음을 4분화음 2개로 읽는 패턴.
    """
    if not divisions or not expected:
        return 0
    eighth = divisions // 2
    fixed = 0
    for (_, _voice), groups in _voice_groups(measure, ns).items():
        total = sum(_note_duration(g[0], ns) or 0 for g in groups)
        if total != expected + divisions:
            continue
        for i in range(2, len(groups) - 1):
            g_prev, g0, g1 = groups[i - 1], groups[i], groups[i + 1]
            if not (
                _is_plain_quarter_group(g0[0], ns, divisions)
                and _is_plain_quarter_group(g1[0], ns, divisions)
            ):
                continue
            if not (
                _is_plain_eighth_group(g_prev[0], ns, divisions)
                and _note_has_beam(g_prev[0], ns)
            ):
                continue
            beam_run = 0
            for k in range(i - 1, -1, -1):
                if _is_plain_eighth_group(groups[k][0], ns, divisions) and _note_has_beam(
                    groups[k][0], ns
                ):
                    beam_run += 1
                else:
                    break
            if beam_run < 2:
                continue
            _halve_group_to_eighth(g0[1], ns)
            _halve_group_to_eighth(g1[1], ns)
            prev_beam = None
            for b in g_prev[0].findall(qname(ns, "beam")):
                prev_beam = b.text
            if prev_beam == "end":
                _set_beam(g_prev[0], ns, "continue")
                _rebeam_group(g0[1], ns, "begin")
                _rebeam_group(g1[1], ns, "end")
            else:
                _rebeam_group(g0[1], ns, "begin")
                _rebeam_group(g1[1], ns, "end")
            fixed += 1
            break
    return fixed


def _repair_quarter_chord_before_rest(
    measure: ET.Element, ns: str, divisions: int, expected: int
) -> int:
    """빔/잇단 run 뒤 4분 화음 + 4분쉼표 — 화음을 8분으로, 쉼표 duration 보정.

    마디 total==expected 일 때만 (리듬 길이 유지).
    """
    # 범용 보정 오작동(종지부 4분음표+4분쉼표 오독으로 오인하는 3개 지점의 오작동 등) 방지를 위해 비활성화
    return 0
    if not divisions or not expected:
        return 0
    eighth = divisions // 2
    fixed = 0
    for (_, _voice), groups in _voice_groups(measure, ns).items():
        if len(groups) < 3:
            continue
        total = sum(_note_duration(g[0], ns) or 0 for g in groups)
        if total != expected:
            continue
        g_q, g_r = groups[-2], groups[-1]
        if not _is_plain_quarter_group(g_q[0], ns, divisions):
            continue
        if not _is_quarter_rest_group(g_r[0], ns, divisions):
            continue
        has_run = False
        for g in groups[:-2]:
            ld = g[0]
            if ld.find(qname(ns, "time-modification")) is not None or _note_has_beam(
                ld, ns
            ):
                has_run = True
                break
        if not has_run:
            continue
        _halve_group_to_eighth(g_q[1], ns)
        rd = g_r[0].find(qname(ns, "duration"))
        if rd is not None and rd.text and rd.text.strip().isdigit():
            rd.text = str(int(rd.text.strip()) + eighth)
        fixed += 1
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


def _note_has_fermata(note: ET.Element, ns: str) -> bool:
    for notations in note.findall(qname(ns, "notations")):
        if notations.find(qname(ns, "fermata")) is not None:
            return True
    return False


def _measure_has_p_dynamic(measure: ET.Element, ns: str) -> bool:
    for direction in measure.findall(qname(ns, "direction")):
        for dtype in direction.findall(qname(ns, "direction-type")):
            dynamics = dtype.find(qname(ns, "dynamics"))
            if dynamics is not None and dynamics.find(qname(ns, "p")) is not None:
                return True
    return False


def _groups_are_beamed_together(leader0: ET.Element, leader1: ET.Element, ns: str) -> bool:
    b0 = leader0.findall(qname(ns, "beam"))
    b1 = leader1.findall(qname(ns, "beam"))
    if not b0 or not b1:
        return False
    return any(b.text in ("begin", "continue", "end") for b in b0) and any(
        b.text in ("begin", "continue", "end") for b in b1
    )


def _repair_eighth_rest_plus_two_eighths_triplet(
    measure: ET.Element, ns: str, max_staff: int, divisions: int, expected: int
) -> int:
    """𝄽8 + 빔 8분 2개 — triplet 표기만 빠졌고 voice 길이가 세잇단 1절만큼 넘칠 때 복원."""
    if not divisions or not expected:
        return 0
    eighth = divisions // 2
    triplet_dur = max(1, (eighth * 2) // 3)
    triplet_saving = 3 * eighth - 3 * triplet_dur
    if triplet_saving <= 0:
        return 0
    fixed = 0
    for (_, _voice), groups in _voice_groups(measure, ns).items():
        total = sum(_note_duration(g[0], ns) or 0 for g in groups)
        if total != expected + triplet_saving:
            continue
        for i in range(len(groups) - 2):
            g0, g1, g2 = groups[i], groups[i + 1], groups[i + 2]
            if not _is_eighth_rest_group(g0[0], ns, divisions):
                continue
            if not (
                _is_plain_eighth_group(g1[0], ns, divisions)
                and _is_plain_eighth_group(g2[0], ns, divisions)
            ):
                continue
            if not _groups_are_beamed_together(g1[0], g2[0], ns):
                continue
            stem_ref = g1[0]
            for j, grp in enumerate((g0, g1, g2)):
                for n in grp[1]:
                    _clear_note_staccato(n, ns)
                    _strip_tuplet_notations(n, ns)
                    _ensure_time_modification(n, ns)
                    _set_note_type_duration(n, ns, triplet_dur, "eighth")
                    _ensure_stem_like_reference(n, grp[2], max_staff, ns, stem_ref)
                    for b in list(n.findall(qname(ns, "beam"))):
                        n.remove(b)
                    if j == 1:
                        _rebeam_group([n], ns, "begin")
                    elif j == 2:
                        _rebeam_group([n], ns, "end")
            plc = _infer_tuplet_placement(g1[0], ns, max_staff)
            _ensure_tuplet_bracket(g0[0], ns, plc, g2[0], has_rest=True)
            fixed += 1
            break
    return fixed


def _repair_same_pitch_continuation_slurs(part: ET.Element, ns: str) -> int:
    """같은 음고로 이어지는 선율(이음줄) — tie 없이 slur만 빠진 경우."""
    fixed = 0
    slur_num = 10
    for measure in part.findall(qname(ns, "measure")):
        for (_, _voice), groups in _voice_groups(measure, ns).items():
            for i in range(len(groups) - 1):
                g0, g1 = groups[i], groups[i + 1]
                if _is_rest(g0[0], ns) or _is_rest(g1[0], ns):
                    continue
                lab0 = _pitch_label(g0[0], ns)
                lab1 = _pitch_label(g1[0], ns)
                if not lab0 or lab0 != lab1:
                    continue
                d0 = _note_duration(g0[0], ns) or 0
                d1 = _note_duration(g1[0], ns) or 0
                if d1 <= d0:
                    continue
                if d0 <= 0 or d1 < 2 * d0:
                    continue
                if _note_has_tie(g0[0], ns, "stop") or _note_has_tie(g1[0], ns, "start"):
                    continue
                if _has_slur(g0[0], ns, slur_num, "stop") or _has_slur(
                    g1[0], ns, slur_num, "start"
                ):
                    continue
                if _add_slur_to_note(g0[0], ns, "start", slur_num) and _add_slur_to_note(
                    g1[0], ns, "stop", slur_num
                ):
                    fixed += 1
                    slur_num += 1
    return fixed


def _chord_pitch_signature(group: tuple, ns: str) -> tuple[str, ...]:
    labs = sorted(_pitch_label(n, ns) or "?" for n in group[1])
    return tuple(labs)


def _note_has_any_slur(note: ET.Element, ns: str) -> bool:
    for notations in note.findall(qname(ns, "notations")):
        if notations.findall(qname(ns, "slur")):
            return True
    return False


# 피아노 알베르지(E4+G4 8분 화음 연속)만 — B4+G4 등 다른 화음은 OMR 그대로 둠.
_REPEATED_CHORD_SLUR_SIGNATURES = frozenset({("E4", "G4")})


def _repair_repeated_chord_slurs(part: ET.Element, ns: str) -> int:
    """연속 동일 E4+G4 8분 화음 — OMR 이음줄 미검출 시 slur 복원 (7·31·45 PR 등)."""
    fixed = 0
    slur_num = 20
    for measure in part.findall(qname(ns, "measure")):
        for (_, _voice), groups in _voice_groups(measure, ns).items():
            voice_slurs = 0
            for i in range(len(groups) - 1):
                if voice_slurs >= 2:
                    break
                g0, g1 = groups[i], groups[i + 1]
                if _is_rest(g0[0], ns) or _is_rest(g1[0], ns):
                    continue
                if len(g0[1]) != 2 or len(g1[1]) != 2:
                    continue
                if g0[0].find(qname(ns, "time-modification")) is not None:
                    continue
                if g1[0].find(qname(ns, "time-modification")) is not None:
                    continue
                if _note_type_text(g0[0], ns) != "eighth":
                    continue
                sig = _chord_pitch_signature(g0, ns)
                if sig not in _REPEATED_CHORD_SLUR_SIGNATURES:
                    continue
                if sig != _chord_pitch_signature(g1, ns):
                    continue
                if _note_has_tie(g0[0], ns, "stop") or _note_has_tie(g1[0], ns, "start"):
                    continue
                if any(_note_has_any_slur(n, ns) for n in g0[1] + g1[1]):
                    continue
                added = _add_slur_between_chord_groups(g0, g1, ns, slur_num)
                if added:
                    fixed += added
                    slur_num += 2
                    voice_slurs += 1
    return fixed


def _apply_sharp_to_note(note: ET.Element, ns: str) -> None:
    pitch_el = note.find(qname(ns, "pitch"))
    if pitch_el is None:
        return
    alter_el = pitch_el.find(qname(ns, "alter"))
    if alter_el is None:
        alter_el = ET.SubElement(pitch_el, qname(ns, "alter"))
    alter_el.text = "1"
    acc = note.find(qname(ns, "accidental"))
    if acc is None:
        acc = ET.SubElement(note, qname(ns, "accidental"))
    acc.text = "sharp"


_SHARP_ORDER = ("F", "C", "G", "D", "A", "E", "B")
_FLAT_ORDER = ("B", "E", "A", "D", "G", "C", "F")


def _part_key_fifths(part: ET.Element, ns: str) -> int:
    fifths = 0
    for measure in part.findall(qname(ns, "measure")):
        for attr in measure.findall(qname(ns, "attributes")):
            key_el = attr.find(qname(ns, "key"))
            if key_el is None:
                continue
            f = key_el.find(qname(ns, "fifths"))
            if f is not None and f.text and f.text.strip().lstrip("-").isdigit():
                fifths = int(f.text.strip())
    return fifths


def _step_key_alter(step: str, fifths: int) -> int:
    if fifths > 0 and step in _SHARP_ORDER[:fifths]:
        return 1
    if fifths < 0 and step in _FLAT_ORDER[:-fifths]:
        return -1
    return 0


def _chord_note_pairs(g0: tuple, g1: tuple, ns: str) -> list[tuple[ET.Element, ET.Element]]:
    map0 = {_pitch_label(n, ns): n for n in g0[1] if _pitch_label(n, ns)}
    map1 = {_pitch_label(n, ns): n for n in g1[1] if _pitch_label(n, ns)}
    return [(map0[k], map1[k]) for k in sorted(set(map0) & set(map1))]


def _add_slur_between_chord_groups(
    g0: tuple, g1: tuple, ns: str, slur_num_base: int
) -> int:
    """화음 slur — 아래 음 below, 위 음 above (각 음머리 높이)."""
    if len(g0[1]) < 2 or len(g1[1]) < 2:
        n0, n1 = g0[0], g1[0]
        if _add_slur_to_note(n0, ns, "start", slur_num_base) and _add_slur_to_note(
            n1, ns, "stop", slur_num_base
        ):
            return 1
        return 0
    low0 = _lower_chord_member(g0[1], ns)
    low1 = _lower_chord_member(g1[1], ns)
    high0 = _upper_chord_member(g0[1], ns)
    high1 = _upper_chord_member(g1[1], ns)
    added = 0
    if _add_slur_to_note(low0, ns, "start", slur_num_base, placement="below") and _add_slur_to_note(
        low1, ns, "stop", slur_num_base, placement="below"
    ):
        added += 1
    if _add_slur_to_note(
        high0, ns, "start", slur_num_base + 1, placement="above"
    ) and _add_slur_to_note(high1, ns, "stop", slur_num_base + 1, placement="above"):
        added += 1
    return added


def _complete_chord_member_slurs(part: ET.Element, ns: str) -> int:
    """한 성부에만 slur가 있을 때 OSMD 방식으로 보완 — normalize가 최종 정리."""
    fixed = 0
    for measure in part.findall(qname(ns, "measure")):
        for (_, _voice), groups in _voice_groups(measure, ns).items():
            for i in range(len(groups) - 1):
                g0, g1 = groups[i], groups[i + 1]
                if len(g0[1]) < 2 or len(g1[1]) < 2:
                    continue
                low0 = _lower_chord_member(g0[1], ns)
                if _note_has_any_slur(low0, ns):
                    continue
                if not any(_note_has_any_slur(n, ns) for n in g0[1] + g1[1]):
                    continue
                nums = [
                    int(s.get("number"))
                    for n in g0[1] + g1[1]
                    for s in n.findall(".//" + qname(ns, "slur"))
                    if s.get("type") == "start" and (s.get("number") or "").isdigit()
                ]
                base = min(nums) if nums else 20
                fixed += _add_slur_between_chord_groups(g0, g1, ns, base)
    return fixed


def _measure_first_chord_note_ids(measure: ET.Element, ns: str) -> set[int]:
    """staff별 첫 비-쉼표 화음 그룹에 속한 note 객체 id."""
    out: set[int] = set()
    seen_staff: set[str] = set()
    for grp in _iter_chord_groups(measure, ns):
        staff = grp[2]
        if staff in seen_staff or _is_rest(grp[0], ns):
            continue
        seen_staff.add(staff)
        for n in grp[1]:
            out.add(id(n))
    return out



def _normalize_accidentals(measure, ns: str, key_fifths: int) -> int:
    fixed = 0
    
    def get_expected_alter(step: str, fifths: int) -> int:
        sharp_order = ('F', 'C', 'G', 'D', 'A', 'E', 'B')
        flat_order = ('B', 'E', 'A', 'D', 'G', 'C', 'F')
        if fifths > 0 and step in sharp_order[:fifths]: return 1
        if fifths < 0 and step in flat_order[:-fifths]: return -1
        return 0

    seen_in_measure = {}
    for n in measure.findall(qname(ns, "note")):
        if _is_rest(n, ns): continue
        pitch = n.find(qname(ns, "pitch"))
        if pitch is None: continue
        step = pitch.find(qname(ns, "step")).text
        octave = pitch.find(qname(ns, "octave")).text
        alter_el = pitch.find(qname(ns, "alter"))
        alter = int(alter_el.text) if alter_el is not None and alter_el.text else 0
        
        acc = n.find(qname(ns, "accidental"))
        if acc is not None:
            acc_type = acc.text.strip() if acc.text else ""
            key = (step, octave)
            
            expected_alter = seen_in_measure.get(key, get_expected_alter(step, key_fifths))
            
            if alter == 0 and acc_type == "natural" and expected_alter == 0:
                n.remove(acc)
                fixed += 1
                
            seen_in_measure[key] = alter
            
    return fixed


def _fix_misread_natural_accidental(
    note: ET.Element,
    ns: str,
    seen: set[tuple[str, str, str, str]],
    first_chord_note_ids: set[int],
) -> tuple[bool, bool]:
    """`#` 글리프 오인 `<accidental>natural</accidental>` → sharp 또는 태그 제거.

    Returns (changed, converted_to_sharp).
    """
    acc = note.find(qname(ns, "accidental"))
    if acc is None or (acc.text or "").strip() != "natural":
        return False, False
    pitch_el = note.find(qname(ns, "pitch"))
    if pitch_el is None:
        return False, False
    alter_el = pitch_el.find(qname(ns, "alter"))
    if alter_el is not None and (alter_el.text or "").strip():
        return False, False
    step_el = pitch_el.find(qname(ns, "step"))
    oct_el = pitch_el.find(qname(ns, "octave"))
    if step_el is None or oct_el is None or not step_el.text or not oct_el.text:
        return False, False
    step = step_el.text.strip()
    voice, staff = _note_voice_staff(note, ns)
    staff = staff or "1"
    key = (staff, voice or "1", step, oct_el.text.strip())
    if key in seen:
        return False, False
    seen.add(key)

    if id(note) in first_chord_note_ids:
        if _note_has_misread_natural(note, ns):
            _apply_sharp_to_note(note, ns)
            return True, True
        return False, False
    note.remove(acc)
    return True, False



def _general_resolve_overfull_measure(
    measure, ns: str, max_staff: int, divisions: int, expected: int
) -> int:
    """마디가 Overfull일 때, 수학적으로 잇단음표 변환이 정확히 들어맞는 구간을 찾아 범용 보정."""
    if not divisions or not expected:
        return 0
    fixed = 0
    for (_, _voice), groups in _voice_groups(measure, ns).items():
        total = sum(_note_duration(g[0], ns) or 0 for g in groups)
        if total <= expected:
            continue
        overflow = total - expected
        eighth = divisions // 2
        quarter = divisions
        
        # Check eighths
        triplet_eighth = max(1, (eighth * 2) // 3)
        eighth_saving = 3 * eighth - 3 * triplet_eighth
        
        # Check quarters
        triplet_quarter = max(1, (quarter * 2) // 3)
        quarter_saving = 3 * quarter - 3 * triplet_quarter

        target_dur = None
        target_saving = 0
        new_type = ''
        new_dur = 0
        
        if eighth_saving > 0 and overflow % eighth_saving == 0:
            target_dur = eighth
            target_saving = eighth_saving
            new_type = 'eighth'
            new_dur = triplet_eighth
        elif quarter_saving > 0 and overflow % quarter_saving == 0:
            target_dur = quarter
            target_saving = quarter_saving
            new_type = 'quarter'
            new_dur = triplet_quarter
            
        if not target_dur:
            continue
            
        num_triplets = overflow // target_saving
        triplets_found = 0
        
        i = 0
        while i <= len(groups) - 3:
            trio = groups[i : i + 3]
            if any(g[0].find(qname(ns, "time-modification")) is not None for g in trio):
                i += 1; continue
            if not all(_note_duration(g[0], ns) == target_dur for g in trio):
                i += 1; continue
            # 쉼표+빔 8분 2개는 overfull 수학 보정으로 세잇단화하지 않음(일반 8분 연결 유지)
            if any(_is_rest(g[0], ns) for g in trio):
                i += 1
                continue
                
            # Ensure candidate triplet notes do not cross beam boundaries
            g0, g1, g2 = trio
            if any(b.text == "end" for b in g0[0].findall(qname(ns, "beam"))):
                i += 1; continue
            if any(b.text in ("begin", "end") for b in g1[0].findall(qname(ns, "beam"))):
                i += 1; continue
            if any(b.text == "begin" for b in g2[0].findall(qname(ns, "beam"))):
                i += 1; continue
                
            for j, grp in enumerate(trio):
                for n in grp[1]:
                    _clear_note_staccato(n, ns)
                    _strip_tuplet_notations(n, ns)
                    _ensure_time_modification(n, ns)
                    _set_note_type_duration(n, ns, new_dur, new_type)
                    if new_type == 'eighth' and not any(_is_rest(g[0], ns) for g in trio):
                        _rebeam_group([n], ns, "begin" if j == 0 else ("end" if j == 2 else "continue"))
            
            has_rest = any(_is_rest(g[0], ns) for g in trio)
            plc = _infer_tuplet_placement(trio[0][0], ns, max_staff)
            _ensure_tuplet_bracket(trio[0][0], ns, plc, trio[2][0], has_rest=has_rest)
            
            fixed += 1
            triplets_found += 1
            i += 3
            if triplets_found >= num_triplets:
                break
    return fixed


def _triplet_eighth_saving(divisions: int) -> int:
    eighth = divisions // 2
    if eighth <= 0:
        return 0
    triplet_dur = max(1, (eighth * 2) // 3)
    return 3 * eighth - 3 * triplet_dur


def _repair_three_eighths_as_triplet(
    measure: ET.Element, ns: str, max_staff: int, divisions: int, expected: int
) -> int:
    """연속 plain 8분 3개 + staccato — voice가 세잇단 1절만큼 넘칠 때만 세잇단화."""
    if not divisions or not expected:
        return 0
    eighth = divisions // 2
    triplet_dur = max(1, (eighth * 2) // 3)
    triplet_saving = _triplet_eighth_saving(divisions)
    if triplet_saving <= 0:
        return 0
    fixed = 0
    for (_, _voice), groups in _voice_groups(measure, ns).items():
        total = sum(_note_duration(g[0], ns) or 0 for g in groups)
        if total != expected + triplet_saving:
            continue
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
            _ensure_tuplet_bracket(trio[0][0], ns, plc, trio[2][0], has_rest=False)
            fixed += 1
            break
    return fixed


def _triplet_eighth_duration(divisions: int) -> int:
    eighth = divisions // 2
    if eighth <= 0:
        return 0
    return max(1, (eighth * 2) // 3)


def _triplet_span_duration(divisions: int) -> int:
    td = _triplet_eighth_duration(divisions)
    return 3 * td if td else 0


def _is_triplet_eighth_group(leader: ET.Element, ns: str) -> bool:
    return (
        leader.find(qname(ns, "time-modification")) is not None
        and _note_type_text(leader, ns) == "eighth"
    )


def _measure_rhythm_repairable(
    measure: ET.Element, ns: str, expected: int, divisions: int
) -> bool:
    """다른 staff voice가 underfull이어도 overfull·exact-fit voice는 리듬 보정 가능."""
    if not expected:
        return False
    totals = [
        sum(_note_duration(g[0], ns) or 0 for g in groups)
        for groups in _voice_groups(measure, ns).values()
    ]
    pitched = [t for t in totals if t > 0]
    if not pitched:
        return False
    if any(t > expected for t in pitched):
        return True
    if any(t == expected for t in pitched):
        return True
    triplet_saving = _triplet_eighth_saving(divisions or 0)
    if triplet_saving and any(t == expected + triplet_saving for t in pitched):
        return True
    eighth = (divisions or 0) // 2
    if eighth and any(t == expected + 2 * eighth for t in pitched):
        return True
    return not any(t < expected for t in pitched)


def _is_misread_quarter_chord_for_triplet(
    group: tuple, ns: str, divisions: int
) -> bool:
    leader, notes, _, _ = group
    if _is_rest(leader, ns):
        return False
    if leader.find(qname(ns, "time-modification")) is not None:
        return False
    if leader.find(qname(ns, "dot")) is not None:
        return False
    if _note_type_text(leader, ns) != "quarter":
        return False
    span = _triplet_span_duration(divisions)
    if not span or _note_duration(leader, ns) != span:
        return False
    if len(notes) < 2:
        return False
    return True


def _clone_triplet_slice_note(
    template: ET.Element,
    ns: str,
    triplet_dur: int,
    beam: str,
    as_chord: bool,
    staff: str,
    max_staff: int,
    stem_ref: ET.Element | None = None,
) -> ET.Element:
    note = copy.deepcopy(template)
    if as_chord:
        if note.find(qname(ns, "chord")) is None:
            ET.SubElement(note, qname(ns, "chord"))
    else:
        ch = note.find(qname(ns, "chord"))
        if ch is not None:
            note.remove(ch)
    _set_note_type_duration(note, ns, triplet_dur, "eighth")
    _ensure_time_modification(note, ns)
    _strip_tuplet_notations(note, ns)
    for notations in list(note.findall(qname(ns, "notations"))):
        for el in list(notations):
            if local_tag(el) == "slur":
                notations.remove(el)
        if len(notations) == 0:
            note.remove(notations)
    _set_beam(note, ns, beam)
    _ensure_stem_like_reference(
        note, staff, max_staff, ns, stem_ref if stem_ref is not None else template
    )
    return note


def _expand_quarter_chord_group_to_triplet(
    measure: ET.Element, group: tuple, ns: str, triplet_dur: int, max_staff: int,
    stem_ref: ET.Element | None = None,
) -> bool:
    """plain 4분 화음 1개(=세잇단 1절 분량) → 세잇단 3slice로 펼침."""
    leader, notes, staff, _voice = group
    if stem_ref is not None and _stem_from_note(stem_ref, ns):
        ref = stem_ref
    else:
        ref = leader
        for n in notes:
            if _stem_from_note(n, ns):
                ref = n
                break
    for j, n in enumerate(notes):
        _ensure_time_modification(n, ns)
        _set_note_type_duration(n, ns, triplet_dur, "eighth")
        _strip_tuplet_notations(n, ns)
        _ensure_stem_like_reference(n, staff, max_staff, ns, ref)
        _set_beam(n, ns, "begin")
    insert_at = list(measure).index(notes[-1]) + 1
    slice2: list[ET.Element] = []
    slice3: list[ET.Element] = []
    for j, template in enumerate(notes):
        slice2.append(
            _clone_triplet_slice_note(
                template, ns, triplet_dur, "continue", j > 0, staff, max_staff, ref
            )
        )
        slice3.append(
            _clone_triplet_slice_note(
                template, ns, triplet_dur, "end", j > 0, staff, max_staff, ref
            )
        )
    for n in slice2 + slice3:
        measure.insert(insert_at, n)
        insert_at += 1
    plc = _infer_tuplet_placement(leader, ns, max_staff)
    _ensure_tuplet_bracket(leader, ns, plc, slice3[0], has_rest=False)
    return True


def _repair_quarter_chords_before_triplet_run(
    measure: ET.Element, ns: str, max_staff: int, divisions: int, expected: int
) -> int:
    """세잇단 run 직전 plain 4분 화음(=세잇단 1절 분량) → 악보처럼 세잇단 3slice로 펼침.

    duration 합은 4분 1개와 세잇단 3slice가 같으므로, voice total==expected 일 때도 펼친다.
    """
    if not divisions:
        return 0
    fixed = 0
    triplet_idx: int | None = None
    for (staff, voice), groups in _voice_groups(measure, ns).items():
        triplet_idx = None
        for i, g in enumerate(groups):
            if g[0].find(qname(ns, "time-modification")) is not None and _note_type_text(
                g[0], ns
            ) == "eighth":
                triplet_idx = i
                break
        if triplet_idx is None or triplet_idx == 0:
            continue
        start = triplet_idx
        while start > 0 and _is_misread_quarter_chord_for_triplet(
            groups[start - 1], ns, divisions
        ):
            start -= 1
        if start == triplet_idx:
            continue
        # Q(A)+Q(B)+T… 는 prefix repair가 A,B,B 로 처리 — 개별 3slice 펼침 금지
        if triplet_idx >= 2:
            g_a, g_b = groups[triplet_idx - 2], groups[triplet_idx - 1]
            if (
                _is_misread_quarter_chord_for_triplet(g_a, ns, divisions)
                and _is_misread_quarter_chord_for_triplet(g_b, ns, divisions)
                and _chord_pitch_signature(g_a, ns) != _chord_pitch_signature(g_b, ns)
            ):
                start = triplet_idx
        triplet_dur = _triplet_eighth_duration(divisions)
        if not triplet_dur:
            continue
        triplet_stem_ref = groups[triplet_idx][0]
        for qi in range(triplet_idx - 1, start - 1, -1):
            if _expand_quarter_chord_group_to_triplet(
                measure,
                groups[qi],
                ns,
                triplet_dur,
                max_staff,
                stem_ref=triplet_stem_ref,
            ):
                fixed += 1
                groups = _voice_groups(measure, ns)[(staff, voice)]
                triplet_idx = None
                for i, g in enumerate(groups):
                    if g[0].find(qname(ns, "time-modification")) is not None and _note_type_text(
                        g[0], ns
                    ) == "eighth":
                        triplet_idx = i
                        break
                if triplet_idx is None:
                    break
                triplet_stem_ref = groups[triplet_idx][0]
    return fixed


def _repair_four_eighths_as_triplet_plus_eighth(
    measure: ET.Element, ns: str, divisions: int
) -> int:
    """한 Voice에 4개의 8분음표만 있고, 이것이 원래 세잇단음표(3) + 8분음표(1)인 경우를 찾아 복구합니다."""
    eighth = divisions // 2
    if eighth <= 0:
        return 0
    triplet_dur = max(1, (eighth * 2) // 3)
    fixed = 0

    for (staff, voice), groups in _voice_groups(measure, ns).items():
        if len(groups) != 4:
            continue
        g0, g1, g2, g3 = groups
        if not (_is_plain_eighth_group(g0[0], ns, divisions) and 
                _is_plain_eighth_group(g1[0], ns, divisions) and 
                _is_plain_eighth_group(g2[0], ns, divisions) and 
                _is_plain_eighth_group(g3[0], ns, divisions)):
            continue
            
        trio = [g0, g1, g2]
        for j, grp in enumerate(trio):
            for n in grp[1]:
                _clear_note_staccato(n, ns)
                _strip_tuplet_notations(n, ns)
                _ensure_time_modification(n, ns)
                _set_note_type_duration(n, ns, triplet_dur, "eighth")
                _rebeam_group([n], ns, "begin" if j == 0 else ("end" if j == 2 else "continue"))
                
        # 4번째 음표 분리
        for n in g3[1]:
            for beam in list(n.findall(qname(ns, "beam"))):
                n.remove(beam)
                
        # Tuplet 기호 추가
        plc = "above"
        _ensure_tuplet_bracket(trio[0][0], ns, plc, trio[2][0], has_rest=False)
        fixed += 1

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
            if total != expected + eighth or total < expected:
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
                nxt = groups[i + 1][0] if i + 1 < len(groups) else None
                if prev is not None:
                    prev_dur = _note_duration(prev, ns) or 0
                    if prev_dur >= 2 * divisions:
                        score -= 10
                    if (
                        _is_plain_quarter_group(prev, ns, divisions)
                        and prev.find(qname(ns, "dot")) is None
                    ):
                        score -= 8
                    if prev.find(qname(ns, "dot")) is not None:
                        if nxt is not None and _is_plain_eighth_group(nxt, ns, divisions):
                            eighth_run = 0
                            for k in range(i + 1, len(groups)):
                                if _is_plain_eighth_group(groups[k][0], ns, divisions):
                                    eighth_run += 1
                                else:
                                    break
                            if eighth_run >= 2:
                                score -= 10
                            else:
                                score += 4
                        else:
                            score += 5
                if i == len(groups) - 1 and prev is not None and _is_rest(prev, ns):
                    score += 3  # 쉼표 뒤 마지막 못갖춘 8분음표
                if i == 1 and _is_rest(groups[0][0], ns) and _note_duration(groups[0][0], ns) == eighth:
                    score += 3  # 마디 시작 8분쉼표 직후 첫 음
                if (
                    prev is not None
                    and _is_eighth_rest_group(prev, ns, divisions)
                    and nxt is not None
                    and _is_plain_eighth_group(nxt, ns, divisions)
                ):
                    score += 6  # 𝄽8 ♩ ♪ ♪ — 가운데 4분 오인
                candidates.append((i, score))
            if not candidates:
                continue
            if len(candidates) == 1:
                if candidates[0][1] <= 0:
                    continue
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


def _ensure_tuplet_normal_fields(note: ET.Element, ns: str) -> bool:
    """잇단 음표에 normal-type/normal-dots — bracket 없을 때 OSMD 겹침 완화."""
    tm = note.find(qname(ns, "time-modification"))
    if tm is None:
        return False
    typ = _note_type_text(note, ns)
    if not typ:
        return False
    changed = False
    nt = tm.find(qname(ns, "normal-type"))
    if nt is None:
        nt = ET.SubElement(tm, qname(ns, "normal-type"))
        changed = True
    if nt.text != typ:
        nt.text = typ
        changed = True
    nd = tm.find(qname(ns, "normal-dots"))
    has_dot = note.find(qname(ns, "dot")) is not None
    if has_dot:
        if nd is None:
            nd = ET.SubElement(tm, qname(ns, "normal-dots"))
            changed = True
        if (nd.text or "1") != "1":
            nd.text = "1"
            changed = True
    elif nd is not None:
        tm.remove(nd)
        changed = True
    return changed


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


def _ensure_tuplet_bracket(
    leader: ET.Element,
    ns: str,
    placement: str,
    stop_leader: ET.Element,
    *,
    has_rest: bool = False,
) -> None:
    _strip_tuplet_notations(leader, ns)
    _strip_tuplet_notations(stop_leader, ns)
    notations = leader.find(qname(ns, "notations"))
    if notations is None:
        notations = ET.SubElement(leader, qname(ns, "notations"))
    tuplet = ET.SubElement(notations, qname(ns, "tuplet"), {"type": "start"})
    _set_tuplet_bracket_attrs(tuplet, has_rest, placement if not has_rest else placement)
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
            if any(_note_has_fermata(n, ns) for n in measure.findall(qname(ns, "note")) if _note_voice_staff(n, ns) == (sec_voice, sec_staff)):
                continue
            forward_el = children[i + 1]
            fd = forward_el.find(qname(ns, "duration"))
            if fd is not None and fd.text and fd.text.strip().isdigit() and int(fd.text.strip()) > 0:
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


def _flatten_underfull_voices_in_measure(measure: ET.Element, ns: str, expected: int) -> int:
    """If staff 1 or staff 2 has fragmented voices that sum to <= expected, serialize the entire measure by staff."""
    if not expected:
        return 0
    staves = {}
    for note in measure.findall(qname(ns, "note")):
        s_el = note.find(qname(ns, "staff"))
        s = s_el.text if s_el is not None else "1"
        if s not in staves:
            staves[s] = []
        staves[s].append(note)
    
    needs_flatten: set[str] = set()
    for s, notes in staves.items():
        v_durs: dict[str, int] = {}
        v_has_note: dict[str, bool] = {}
        for note in notes:
            if note.find(qname(ns, "chord")) is not None:
                continue
            v_el = note.find(qname(ns, "voice"))
            v = v_el.text if v_el is not None else "1"
            if _is_rest(note, ns):
                v_durs[v] = v_durs.get(v, 0) + (_note_duration(note, ns) or 0)
            else:
                v_has_note[v] = True
                v_durs[v] = v_durs.get(v, 0) + (_note_duration(note, ns) or 0)
        if len(v_durs) <= 1:
            continue
        v_with_notes = [v for v in v_durs if v_has_note.get(v, False)]
        if len(v_with_notes) <= 1:
            needs_flatten.add(s)
        else:
            if any(
                v_has_note.get(v, False) is False and (v_durs.get(v) or 0) > 0
                for v in v_durs
            ):
                continue  # 쉼표 전용 voice — 멜로디 voice와 병렬
            if sum(v_durs.values()) == expected:
                continue  # voice 합이 마디 길이와 같으면 병렬 레이어로 간주
            if sum(v_durs.values()) <= expected + (expected // 4) or max(v_durs.values()) < expected:
                needs_flatten.add(s)

    if not needs_flatten:
        return 0

    def get_x(grp):
        leader = grp[0]
        x = leader.get("default-x")
        try:
            return float(x) if x is not None else 9999.0
        except ValueError:
            return 9999.0

    # 1. Extract other elements (attributes, directions, prints, etc.)
    other_elements = [el for el in list(measure) if local_tag(el) not in ("note", "backup", "forward")]

    # 2. Clear all children from the measure
    for el in list(measure):
        measure.remove(el)

    # 3. Put non-note elements at the beginning of the measure
    for el in other_elements:
        measure.append(el)

    # 4. Group notes by staff
    all_staves = sorted(list(staves.keys()))
    for i, s in enumerate(all_staves):
        notes = staves[s]
        
        if s in needs_flatten:
            # Flatten notes of this staff
            groups = []
            current_group = []
            for n in notes:
                if n.find(qname(ns, "chord")) is None:
                    if current_group:
                        groups.append(current_group)
                    current_group = [n]
                else:
                    current_group.append(n)
            if current_group:
                groups.append(current_group)
                
            groups.sort(key=get_x)
            
            flat_notes = []
            for grp in groups:
                for n in grp:
                    v_el = n.find(qname(ns, "voice"))
                    if v_el is not None:
                        v_el.text = "1" if s == "1" else "5"
                    flat_notes.append(n)
            
            for n in flat_notes:
                measure.append(n)
                
            total_dur = sum(_note_duration(n, ns) or 0 for n in flat_notes if n.find(qname(ns, "chord")) is None)
            
        else:
            # Keep original voices of this staff
            voice_groups_dict = {}
            for n in notes:
                v_el = n.find(qname(ns, "voice"))
                v = v_el.text if v_el is not None else "1"
                if v not in voice_groups_dict:
                    voice_groups_dict[v] = []
                voice_groups_dict[v].append(n)
                
            sorted_voices = sorted(list(voice_groups_dict.keys()))
            total_dur = 0
            for vi, v in enumerate(sorted_voices):
                v_notes = voice_groups_dict[v]
                for n in v_notes:
                    measure.append(n)
                
                v_dur = sum(_note_duration(n, ns) or 0 for n in v_notes if n.find(qname(ns, "chord")) is None)
                total_dur = v_dur
                
                if vi < len(sorted_voices) - 1 and v_dur > 0:
                    b = ET.Element(qname(ns, "backup"))
                    d = ET.SubElement(b, qname(ns, "duration"))
                    d.text = str(v_dur)
                    measure.append(b)
                    
        if i < len(all_staves) - 1 and total_dur > 0:
            b = ET.Element(qname(ns, "backup"))
            d = ET.SubElement(b, qname(ns, "duration"))
            d.text = str(total_dur)
            measure.append(b)

    return len(needs_flatten)


def _repair_missing_accidental_by_backward_propagation(measure: ET.Element, ns: str) -> int:
    """(비활성) 마디 후반 accidental을 앞 음표에 역전파 — 조표·키 문맥을 무시하고
    C5→C#5 등을 일괄 바꿔 # 유실/과다 오류를 유발한다."""
    return 0


def _repair_staccato_as_fermata_before_rest(measure: ET.Element, ns: str) -> int:
    """마디 끝 𝄽 직전 음의 staccato → fermata (Audiveris 늘임표 오인)."""
    fixed = 0
    for (_, _voice), groups in _voice_groups(measure, ns).items():
        if len(groups) < 2:
            continue
        g_note, g_rest = groups[-2], groups[-1]
        if not _is_rest(g_rest[0], ns) or _is_rest(g_note[0], ns):
            continue
        if _note_has_fermata(g_note[0], ns):
            continue
        if not any(_note_has_staccato(n, ns) for n in g_note[1]):
            continue
        for n in g_note[1]:
            _clear_note_staccato(n, ns)
            notations = n.find(qname(ns, "notations"))
            if notations is None:
                notations = ET.SubElement(n, qname(ns, "notations"))
            fermata = notations.find(qname(ns, "fermata"))
            if fermata is None:
                fermata = ET.SubElement(notations, qname(ns, "fermata"))
            if fermata.get("type") is None:
                fermata.set("type", "upright")
            fixed += 1
    return fixed


def _insert_forward_before_voice_backup(
    measure: ET.Element, ns: str, staff: str, voice: str, duration: int
) -> None:
    if duration <= 0:
        return
    backup_el, _ = _voice_backup_after_notes(measure, ns, staff, voice)
    if backup_el is None:
        return
    fwd = ET.Element(qname(ns, "forward"))
    ET.SubElement(fwd, qname(ns, "duration")).text = str(duration)
    measure.insert(list(measure).index(backup_el), fwd)


def _is_melodic_false_chord_group(group: tuple, ns: str) -> bool:
    """세잇단 1·2slice를 한 4분 화음으로 합친 경우(B1+B2 등)."""
    notes = group[1]
    if len(notes) != 2:
        return False
    if _is_rest(notes[0], ns):
        return False
    pitches: list[tuple[str, int]] = []
    for n in notes:
        pitch = n.find(qname(ns, "pitch"))
        if pitch is None:
            return False
        step_el = pitch.find(qname(ns, "step"))
        oct_el = pitch.find(qname(ns, "octave"))
        if step_el is None or oct_el is None or not (oct_el.text or "").strip().isdigit():
            return False
        pitches.append((step_el.text or "", int(oct_el.text.strip())))
    return pitches[0][0] == pitches[1][0] and pitches[0][1] != pitches[1][1]


def _detach_chord_tail_as_new_group(
    measure: ET.Element, group: tuple, ns: str
) -> tuple | None:
    """화음 2번째 음표를 chord 해제 후 별도 이벤트로 분리."""
    leader, notes, staff, voice = group
    if len(notes) < 2:
        return None
    tail = notes[1]
    ch = tail.find(qname(ns, "chord"))
    if ch is not None:
        tail.remove(ch)
    return (tail, [tail], staff, voice)


def _repair_two_collapsed_triplet_spans(
    measure: ET.Element, ns: str, max_staff: int, divisions: int, expected: int
) -> int:
    """4분 2개(세잇단 2절 분량) + 세잇단 6slice — 4×3=12화음으로 복구.

    Audiveris BEAMS/RHYTHMS: 첫 두 세잇단 묶음을 stem-up 4분으로 읽고,
    1·2slice를 한 화음(B1+B2)으로 합치는 패턴(인쇄 45 PL 등).
    """
    if not divisions or not expected:
        return 0
    triplet_dur = _triplet_eighth_duration(divisions)
    span = _triplet_span_duration(divisions)
    if not triplet_dur or not span:
        return 0
    fixed = 0
    for (staff, voice), groups in _voice_groups(measure, ns).items():
        if len(groups) != 8:
            continue
        total = sum(_note_duration(g[0], ns) or 0 for g in groups)
        if total != expected:
            continue
        g0, g1, g2 = groups[0], groups[1], groups[2]
        tail = groups[2:]
        if not (
            _is_misread_quarter_chord_for_triplet(g0, ns, divisions)
            and _is_misread_quarter_chord_for_triplet(g1, ns, divisions)
        ):
            continue
        if g0[0].find(qname(ns, "time-modification")) is not None:
            continue
        if g1[0].find(qname(ns, "time-modification")) is not None:
            continue
        if _chord_pitch_signature(g0, ns) == _chord_pitch_signature(g1, ns):
            continue
        if g2[0].find(qname(ns, "time-modification")) is None:
            continue
        if _chord_pitch_signature(g1, ns) != _chord_pitch_signature(g2, ns):
            continue
        if not all(
            _is_triplet_eighth_group(g[0], ns)
            and _note_duration(g[0], ns) == triplet_dur
            for g in tail
        ):
            continue
        if len(tail) != 6:
            continue

        stem_ref = g2[0]
        slice3_template = g2
        collapsed_q2 = g1
        split_group = g0
        if _is_melodic_false_chord_group(g0, ns):
            detached = _detach_chord_tail_as_new_group(measure, g0, ns)
            if detached is None:
                continue
            groups = _voice_groups(measure, ns)[(staff, voice)]
            split_group = groups[0]
            g0_tail = groups[1]
            for j, (grp, beam) in enumerate(
                ((split_group, "begin"), (g0_tail, "continue"))
            ):
                for n in grp[1]:
                    _clear_note_staccato(n, ns)
                    _ensure_time_modification(n, ns)
                    _set_note_type_duration(n, ns, triplet_dur, "eighth")
                    _strip_tuplet_notations(n, ns)
                    _set_beam(n, ns, beam)
                    _ensure_stem_like_reference(
                        n, staff, max_staff, ns, split_group[0] if j == 0 else g0_tail[0]
                    )
            slice3_notes: list[ET.Element] = []
            insert_at = list(measure).index(g0_tail[1][-1]) + 1
            for j, template in enumerate(slice3_template[1]):
                clone = _clone_triplet_slice_note(
                    template,
                    ns,
                    triplet_dur,
                    "end",
                    j > 0,
                    staff,
                    max_staff,
                    stem_ref,
                )
                measure.insert(insert_at, clone)
                insert_at += 1
                slice3_notes.append(clone)
            plc = _infer_tuplet_placement(split_group[0], ns, max_staff)
            _ensure_tuplet_bracket(
                split_group[0], ns, plc, slice3_notes[0], has_rest=False
            )
            groups = _voice_groups(measure, ns)[(staff, voice)]
            g1 = next(
                (
                    g
                    for g in groups
                    if g is collapsed_q2
                    or _is_misread_quarter_chord_for_triplet(g, ns, divisions)
                ),
                None,
            )
        else:
            for gi, grp in enumerate((g0, g1, g2)):
                beam = "begin" if gi == 0 else ("end" if gi == 2 else "continue")
                for n in grp[1]:
                    _clear_note_staccato(n, ns)
                    _ensure_time_modification(n, ns)
                    _set_note_type_duration(n, ns, triplet_dur, "eighth")
                    _strip_tuplet_notations(n, ns)
                    _set_beam(n, ns, beam)
                    _ensure_stem_like_reference(n, staff, max_staff, ns, stem_ref)
            for grp in (g0, g1, g2):
                for n in grp[1]:
                    _strip_tuplet_notations(n, ns)
            plc = _infer_tuplet_placement(g0[0], ns, max_staff)
            _ensure_tuplet_bracket(g0[0], ns, plc, g2[0], has_rest=False)
            groups = _voice_groups(measure, ns)[(staff, voice)]
            g1 = next(
                (
                    g
                    for g in groups
                    if _is_misread_quarter_chord_for_triplet(g, ns, divisions)
                ),
                None,
            )

        if g1 is None:
            continue
        if not _expand_quarter_chord_group_to_triplet(
            measure, g1, ns, triplet_dur, max_staff, stem_ref=stem_ref
        ):
            continue

        groups = _voice_groups(measure, ns)[(staff, voice)]
        run: list[tuple] = []
        for g in groups:
            if _is_triplet_eighth_group(g[0], ns):
                run.append(g)
                if len(run) == 3:
                    _rebeam_group(run[0][1], ns, "begin")
                    _rebeam_group(run[1][1], ns, "continue")
                    _rebeam_group(run[2][1], ns, "end")
                    run = []
            else:
                run = []
        fixed += 1
    return fixed


def _repair_two_quarters_as_triplet_prefix(
    measure: ET.Element, ns: str, max_staff: int, expected: int, divisions: int = 0
) -> int:
    """4분 2개(서로 다른 화음) + 세잇단 run — 앞 2음을 세잇단 1·2slice, 3slice는 기존 run.

    인쇄 45 PL 등: Q(A)+Q(B)+T(B…) → T(A,B,B)… (셋째 slice는 둘째와 동일).
    """
    fixed = 0
    for (staff, voice), groups in _voice_groups(measure, ns).items():
        if len(groups) < 3 or not expected:
            continue
        total = sum(_note_duration(g[0], ns) or 0 for g in groups)
        g0, g1, g2 = groups[0], groups[1], groups[2]
        quarter_dur = _note_duration(g0[0], ns)
        if quarter_dur is None or _note_duration(g1[0], ns) != quarter_dur:
            continue
        if divisions:
            if not (
                _is_misread_quarter_chord_for_triplet(g0, ns, divisions)
                and _is_misread_quarter_chord_for_triplet(g1, ns, divisions)
            ):
                continue
        else:
            if _note_type_text(g0[0], ns) != "quarter" or _note_type_text(g1[0], ns) != "quarter":
                continue
        if g0[0].find(qname(ns, "time-modification")) is not None:
            continue
        if g1[0].find(qname(ns, "time-modification")) is not None:
            continue
        if g0[0].find(qname(ns, "dot")) or g1[0].find(qname(ns, "dot")):
            continue
        if _chord_pitch_signature(g0, ns) == _chord_pitch_signature(g1, ns):
            continue
        if g2[0].find(qname(ns, "time-modification")) is None:
            continue
        triplet_eighth_dur = _note_duration(g2[0], ns)
        if triplet_eighth_dur is None or triplet_eighth_dur <= 0:
            continue
        if _chord_pitch_signature(g1, ns) != _chord_pitch_signature(g2, ns):
            continue
        overfull = total == expected + quarter_dur
        exact_fill = total == expected
        if not (overfull or exact_fill):
            continue
        tail = groups[2:]
        if not all(
            _note_duration(g[0], ns) == triplet_eighth_dur
            and g[0].find(qname(ns, "time-modification")) is not None
            for g in tail
        ):
            continue

        for gi, grp in enumerate((g0, g1)):
            for n in grp[1]:
                _clear_note_staccato(n, ns)
                _ensure_time_modification(n, ns)
                _set_note_type_duration(n, ns, triplet_eighth_dur, "eighth")
                _set_beam(n, ns, "begin" if gi == 0 else "continue")
                _ensure_stem_like_reference(n, staff, max_staff, ns, g2[0])
        for n in g2[1]:
            _clear_note_staccato(n, ns)
            _strip_tuplet_notations(n, ns)
            _set_beam(n, ns, "end")
            _ensure_stem_like_reference(n, staff, max_staff, ns, g2[0])
        for grp in (g0, g1, g2):
            for n in grp[1]:
                _strip_tuplet_notations(n, ns)
        plc = _infer_tuplet_placement(g0[0], ns, max_staff)
        _ensure_tuplet_bracket(g0[0], ns, plc, g2[0], has_rest=False)

        if exact_fill:
            # g0/g1 4분→8분T 로 줄인 duration 은 forward 로 voice 타임라인 유지
            forward_dur = 2 * (quarter_dur - triplet_eighth_dur)
            _insert_forward_before_voice_backup(
                measure, ns, staff, voice, forward_dur
            )

        groups = _voice_groups(measure, ns)[(staff, voice)]
        run: list[tuple] = []
        for g in groups[3:]:
            if _is_triplet_eighth_group(g[0], ns):
                run.append(g)
                if len(run) == 3:
                    _rebeam_group(run[0][1], ns, "begin")
                    _rebeam_group(run[1][1], ns, "continue")
                    _rebeam_group(run[2][1], ns, "end")
                    run = []
            else:
                run = []

        fixed += 1
    return fixed


def _fix_tuplet_brackets_in_measure(measure: ET.Element, ns: str, max_staff: int = 1) -> int:
    """잇단 bracket 정책: 쉼표 포함만 bracket, 그 외 숫자 '3'만."""
    fixed = 0
    for note in measure.findall(qname(ns, "note")):
        for notations in note.findall(qname(ns, "notations")):
            for tuplet in notations.findall(qname(ns, "tuplet")):
                if tuplet.get("type") != "start":
                    continue
                # Extract run manually for accurate placement
                run_notes = []
                voice, staff = _note_voice_staff(note, ns)
                in_run = False
                for grp in _iter_chord_groups(measure, ns):
                    leader = grp[0]
                    if leader is note: in_run = True
                    if not in_run: continue
                    if (grp[2], grp[3]) != (staff or "1", voice or "1"): continue
                    run_notes.append(leader)
                    is_stop = False
                    for notations in leader.findall(qname(ns, "notations")):
                        for t in notations.findall(qname(ns, "tuplet")):
                            if t.get("type") == "stop": is_stop = True
                    if is_stop: break
                    
                has_rest = any(_is_rest(n, ns) for n in run_notes)
                placement = None
                if _tuplet_actual_notes(note, ns) == 3:
                    placement = _infer_tuplet_placement(run_notes, ns, max_staff)
                before = (tuplet.get("show-bracket"), tuplet.get("bracket"))
                _set_tuplet_bracket_attrs(tuplet, has_rest, placement)
                if before != (tuplet.get("show-bracket"), tuplet.get("bracket")):
                    fixed += 1
    return fixed


def _has_tuplet_element(note: ET.Element, ns: str) -> bool:
    for notations in note.findall(qname(ns, "notations")):
        if notations.findall(qname(ns, "tuplet")):
            return True
    return False


def _add_tuplet_element(
    note: ET.Element,
    ns: str,
    tuplet_type: str,
    placement: str | None = None,
    *,
    has_rest: bool = False,
) -> None:
    notations = note.find(qname(ns, "notations"))
    if notations is None:
        notations = ET.SubElement(note, qname(ns, "notations"))
    if tuplet_type == "start":
        tuplet = ET.SubElement(notations, qname(ns, "tuplet"), {"type": "start"})
        _set_tuplet_bracket_attrs(tuplet, has_rest, placement if not has_rest else placement)
    else:
        ET.SubElement(notations, qname(ns, "tuplet"), {"type": tuplet_type})


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
                        run_has_rest = any(_is_rest(g[0], ns) for g in run)
                        _add_tuplet_element(
                            run[0][0], ns, "start", placement, has_rest=run_has_rest
                        )
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


def _extrapolate_chord_ties(part, ns: str) -> int:
    """동일 화음 내 일부 노트만 Tie가 있는 경우 전체 공통 피치로 확장."""
    completed = 0
    for measure in part.findall(qname(ns, "measure")):
        for (_, _voice), groups in _voice_groups(measure, ns).items():
            for i in range(len(groups) - 1):
                a_notes = groups[i][1]
                b_notes = groups[i+1][1]
                a_map = _group_pitch_map(a_notes, ns)
                b_map = _group_pitch_map(b_notes, ns)
                common = [p for p in a_map if p in b_map]
                if not common: continue
                
                has_start = any(_note_has_tie(a_map[p], ns, "start") for p in common)
                has_stop = any(_note_has_tie(b_map[p], ns, "stop") for p in common)
                
                if has_start or has_stop:
                    for p in common:
                        if not _note_has_tie(a_map[p], ns, "start"):
                            _add_tie(a_map[p], ns, "start")
                            completed += 1
                        if not _note_has_tie(b_map[p], ns, "stop"):
                            _add_tie(b_map[p], ns, "stop")
    return completed


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
        "quarter_chord_triplet_expanded": 0,
        "chord_duplicates_removed": 0,
        "misplaced_sharp_relocated": 0,
        "misread_natural_to_sharp": 0,
        "quarter_pair_eighth_fixed": 0,
        "two_quarter_voice_eighth_fixed": 0,
        "three_eighth_triplet_fixed": 0,
        "rest_eighth_triplet_fixed": 0,
        "continuation_slurs_added": 0,
        "repeated_chord_slurs_added": 0,
        "chord_slurs_completed": 0,
        "slur_placements_fixed": 0,
        "piano_stems_fixed": 0,
        "spurious_natural_removed": 0,
        "tuplet_brackets_adjusted": 0,
        "tuplet_normal_fields_fixed": 0,
        "fermata_from_staccato_fixed": 0,
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
            stats["voice_consolidated"] += _flatten_underfull_voices_in_measure(
                measure, ns, expected or 0
            )
            stats["misread_natural_to_sharp"] += _repair_missing_accidental_by_backward_propagation(measure, ns)
            key_fifths = _part_key_fifths(part, ns)
            stats["misplaced_sharp_relocated"] += _repair_misplaced_sharp_via_duplicate(
                measure, ns, key_fifths
            )
            stats["chord_duplicates_removed"] += _dedupe_chord_members_in_measure(measure, ns)
            if _measure_rhythm_repairable(measure, ns, expected or 0, divisions or 0):
                stats["three_eighth_triplet_fixed"] += _general_resolve_overfull_measure(
                    measure, ns, max_staff, divisions or 0, expected or 0
                )
                stats["quarter_pair_eighth_fixed"] += _repair_swap_leading_qq_with_beamed_pair(
                    measure, ns, divisions or 0, expected or 0
                )
                stats["quarter_pair_eighth_fixed"] += _repair_leading_quarter_pair(
                    measure, ns, divisions or 0, expected or 0
                )
                stats["quarter_pair_eighth_fixed"] += _repair_quarter_eighth_quarter_lost_final(
                    measure, ns, divisions or 0, expected or 0
                )
                stats["quarter_pair_eighth_fixed"] += _repair_quarter_pair_before_eighths(
                    measure, ns, divisions or 0, expected or 0
                )
                stats["quarter_pair_eighth_fixed"] += _repair_quarter_pair_after_beam_run(
                    measure, ns, divisions or 0, expected or 0
                )
                stats["quarter_pair_eighth_fixed"] += _repair_quarter_chord_before_rest(
                    measure, ns, divisions or 0, expected or 0
                )
                stats["two_quarter_voice_eighth_fixed"] += _repair_two_quarter_voice_as_eighths(
                    measure, ns, divisions or 0, expected or 0
                )
                stats["three_eighth_triplet_fixed"] += _repair_three_eighths_as_triplet(
                    measure, ns, max_staff, divisions or 0, expected or 0
                )
                stats["rest_eighth_triplet_fixed"] += _repair_eighth_rest_plus_two_eighths_triplet(
                    measure, ns, max_staff, divisions or 0, expected or 0
                )
                stats["triplet_quarter_prefix_repaired"] += _repair_two_collapsed_triplet_spans(
                    measure, ns, max_staff, divisions or 0, expected or 0
                )
                stats["quarter_chord_triplet_expanded"] += _repair_quarter_chords_before_triplet_run(
                    measure, ns, max_staff, divisions or 0, expected or 0
                )
            stats["fermata_from_staccato_fixed"] += _repair_staccato_as_fermata_before_rest(
                measure, ns
            )
        dotted_fixed, lost_eighth = _repair_dotted_quarter_misread(part, ns)
        stats["dotted_quarter_eighth_fixed"] += dotted_fixed
        stats["lost_eighth_restored"] += lost_eighth

        fixed, rest_fixed = _repair_overfull_eighth(part, ns)
        stats["overfull_eighth_fixed"] += fixed
        stats["overfull_rest_normalized"] += rest_fixed

    # 3) 음표 발명·성부 재배치 등 최후 수단 패치는 일반화 원칙에 따라 제거되었습니다.
    stats["score_patches_applied"] = 0

    for part in root.findall(qname(ns, "part")):
        max_staff = _max_staff_in_part(part, ns)
        key_fifths = _part_key_fifths(part, ns)

        stats["tuplet_notations_added"] += _ensure_tuplet_notations(part, ns, max_staff)
        if _part_has_two_staves(part, ns):
            stats["tuplet_dynamics_removed"] += _remove_spurious_tuplet_dynamics(part, ns)

        for measure in part.findall(qname(ns, "measure")):
            stats["tuplet_brackets_adjusted"] += _renumber_tuplets_in_measure(measure, ns)
            seen_natural: set[tuple[str, str, str, str]] = set()
            first_chord_ids = _measure_first_chord_note_ids(measure, ns)
            for note in measure.findall(qname(ns, "note")):
                if _remove_duplicate_staccato_as_natural(note, ns):
                    stats["natural_from_staccato_removed"] += 1
                if _remove_beam_side_staccato_on_tuplet(note, ns):
                    stats["tuplet_staccato_removed"] += 1
                if _fix_tuplet_show_numbers(note, ns, max_staff, measure):
                    stats["tuplet_show_number_fixed"] += 1
                if _ensure_tuplet_normal_fields(note, ns):
                    stats["tuplet_normal_fields_fixed"] += 1
            stats["spurious_natural_removed"] += _normalize_accidentals(measure, ns, key_fifths)

        stats["chord_ties_completed"] += _extrapolate_chord_ties(part, ns)
        stats["chord_ties_completed"] += _extrapolate_chord_ties(part, ns)
        completed, system_added = _restore_ties_between_measures(part, ns)
        stats["chord_ties_completed"] += completed
        stats["system_break_ties_added"] += system_added

        if _part_is_piano(part.get("id"), root, ns) or _part_has_two_staves(part, ns):
            stats["slurs_injected"] += _inject_missing_slurs_piano_m6(part, ns)
        stats["continuation_slurs_added"] += _repair_same_pitch_continuation_slurs(part, ns)
        stats["repeated_chord_slurs_added"] += _repair_repeated_chord_slurs(part, ns)
        stats["chord_slurs_completed"] += _complete_chord_member_slurs(part, ns)
        stats["slur_placements_fixed"] += _normalize_slur_placements(part, ns)

        for measure in part.findall(qname(ns, "measure")):
            stats["tuplet_brackets_adjusted"] += _fix_tuplet_brackets_in_measure(
                measure, ns, max_staff
            )

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
        "tuplet_brackets_adjusted": 0,
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
