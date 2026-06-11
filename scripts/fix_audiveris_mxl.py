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
    if _tuplet_actual_notes(note, ns) is None:
        return False
    stem_el = note.find(qname(ns, "stem"))
    stem = (stem_el.text or "").strip() if stem_el is not None and stem_el.text else ""
    if stem not in ("up", "down"):
        return False
    beam_side = "above" if stem == "up" else "below"
    removed = False
    for notations in list(note.findall(qname(ns, "notations"))):
        for arts in list(notations.findall(qname(ns, "articulations"))):
            for art in list(arts):
                if local_tag(art) == "staccato" and art.get("placement") == beam_side:
                    arts.remove(art)
                    removed = True
            if len(arts) == 0:
                notations.remove(arts)
        if len(notations) == 0:
            note.remove(notations)
    return removed


def _fix_tuplet_show_numbers(note: ET.Element, ns: str) -> bool:
    actual = _tuplet_actual_notes(note, ns)
    if actual is None:
        return False
    changed = False
    for notations in note.findall(qname(ns, "notations")):
        for tuplet in notations.findall(qname(ns, "tuplet")):
            if tuplet.get("type") != "start":
                continue
            # 'both'는 OSMD 등에서 '3:2'로 그려져 세잇단 숫자가 잘못 보임 — 항상 'actual'('3'만 표시)로 통일.
            if tuplet.get("show-number") != "actual":
                tuplet.set("show-number", "actual")
            if actual == 3 and not tuplet.get("placement"):
                tuplet.set("placement", "above")
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
        "score_patches_applied": 0,
        "overfull_eighth_fixed": 0,
        "overfull_rest_normalized": 0,
        "chord_ties_completed": 0,
        "system_break_ties_added": 0,
    }

    # 악보별 패턴 패치 (내용 시그니처가 일치할 때만 동작) — 일반 보정보다 먼저.
    try:
        from omr_score_patches import apply_score_patches

        stats["score_patches_applied"] = apply_score_patches(root, ns)
    except ImportError:
        pass

    for part in root.findall(qname(ns, "part")):
        for measure in part.findall(qname(ns, "measure")):
            tc, dr = _clean_measure(measure, ns, parents)
            stats["text_nodes_cleared"] += tc
            stats["directions_removed"] += dr

        for note in part.iter(qname(ns, "note")):
            if _remove_duplicate_staccato_as_natural(note, ns):
                stats["natural_from_staccato_removed"] += 1
            if _remove_beam_side_staccato_on_tuplet(note, ns):
                stats["tuplet_staccato_removed"] += 1
            if _fix_tuplet_show_numbers(note, ns):
                stats["tuplet_show_number_fixed"] += 1

        fixed, rest_fixed = _repair_overfull_eighth(part, ns)
        stats["overfull_eighth_fixed"] += fixed
        stats["overfull_rest_normalized"] += rest_fixed

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
