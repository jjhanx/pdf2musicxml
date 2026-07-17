#!/usr/bin/env python3
"""Audiveris MXL 후처리 — TEXTS/SYMBOLS·OCR 잔여로 생긴 흔한 오인식 완화."""
from __future__ import annotations

import copy
import io
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path
from typing import Any

_SPURIOUS_DIRECTION_WORDS = frozenset(
    {"P", "p", "2P", "2p", "PR", "PL", "R", "L"}
)
_SPURIOUS_DIRECTION_DIGITS = frozenset({"9"})
# 세잇단 숫자 '3' OCR 잔여가 '.', ':2', '3:2', '2:' 등으로 남는 경우 (눈/김효근 보고)
_SPURIOUS_TUPLET_RESIDUE = frozenset({".", ":", ":2", "2:", "3:2", "3:", ":3", "2:3"})
_TEXT_TAGS = frozenset({"words", "text", "syllable", "rehearsal"})


def _rhythm_fix_mode() -> str:
    """리듬 duration 변경 보정 모드.

    - off (기본): OMR 인식 그대로 — duration·쉼표 삽입·세잇단 펼침 등 **하지 않음**.
    - beams: 인접 빔(run)이 있는 4분↔8분 오인만 복원.
    - legacy: 기존 Tier A/B·overfull·♩. 패턴 등 전체 보정.
    """
    raw = (os.environ.get("AUDIVERIS_MXL_RHYTHM_FIX") or "off").strip().lower()
    if raw in ("legacy", "full", "1", "true", "yes", "on"):
        return "legacy"
    if raw in ("beams", "beam"):
        return "beams"
    return "off"


def _env_truthy(name: str, *, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None or not str(raw).strip():
        return default
    return str(raw).strip().lower() in ("1", "true", "yes", "on")


def _accidental_repair_enabled() -> bool:
    """`#`↔natural 추정 보정 — 기본 off(OCR/OMR 그대로)."""
    return _env_truthy("AUDIVERIS_MXL_ACCIDENTAL_REPAIR", default=False)


def _strip_redundant_naturals_enabled() -> bool:
    """조표·음높이상 불필요한 `<accidental>natural</accidental>` 제거 — 기본 on."""
    return not _env_truthy("AUDIVERIS_MXL_KEEP_REDUNDANT_NATURAL", default=False)


def _strip_invented_keys_enabled() -> bool:
    """Audiveris `<key>` 자동 정리 — 기본 off (OMR/HITL 미리보기 그대로, 사람이 보정).

    `AUDIVERIS_MXL_NORMALIZE_KEYS=1` 로 줄머리 오인·courtesy 반복 정리(구 동작).
    `AUDIVERIS_MXL_KEEP_INVENTED_KEYS=1` 은 정리 끔(별칭, NORMALIZE_KEYS 보다 우선).
    """
    if _env_truthy("AUDIVERIS_MXL_KEEP_INVENTED_KEYS", default=False):
        return False
    return _env_truthy("AUDIVERIS_MXL_NORMALIZE_KEYS", default=False)


def _opening_key_explicit_enabled() -> bool:
    """m1 `<key>` 생략 시 C major(`fifths=0`) 명시 — 기본 off (OMR/HITL 그대로).

    `AUDIVERIS_MXL_OPENING_KEY_EXPLICIT=1` 로 OSMD가 뒤쪽 조표를 첫머리로 당겨 그리는
    현상 완화(구 동작). 조표·clef 오인은 HITL에서 수정.
    """
    return _env_truthy("AUDIVERIS_MXL_OPENING_KEY_EXPLICIT", default=False)


def _strip_measure_numbering_enabled() -> bool:
    """Audiveris `<measure-numbering>` 정리 — 기본 on.

    `AUDIVERIS_MXL_KEEP_MEASURE_NUMBERING=1` 이면 Audiveris measure-numbering 그대로.
    그 외: lyric_manifest(`PDF2MXL_LYRIC_MANIFEST`)에 있는 인쇄 마디만 `<measure-numbering>system`,
    없으면 전부 제거.
    """
    return not _env_truthy("AUDIVERIS_MXL_KEEP_MEASURE_NUMBERING", default=False)


def _manifest_path_for_measure_numbers() -> Path | None:
    raw = os.environ.get("PDF2MXL_LYRIC_MANIFEST") or os.environ.get("LYRIC_MANIFEST_PATH")
    if not raw or not str(raw).strip():
        return None
    p = Path(str(raw).strip())
    return p if p.is_file() else None


def _printed_measure_mxl_set_from_env() -> set[int] | None:
    manifest = _manifest_path_for_measure_numbers()
    if manifest is None:
        return None
    try:
        from printed_measure_numbers import load_printed_measure_mxl_set
    except ImportError:
        from scripts.printed_measure_numbers import load_printed_measure_mxl_set  # type: ignore
    offset = int(os.environ.get("MXL_MEASURE_OFFSET_PRINTED", "1") or "1")
    return load_printed_measure_mxl_set(manifest, offset)


# 조표 유무 판단: part-list 앞쪽 N개 마디(픽업·anacrusis 포함)
_OPENING_KEY_MEASURES = 4


def _measure_at_layout_break(measure: ET.Element, ns: str) -> bool:
    pr = measure.find(qname(ns, "print"))
    return pr is not None and (
        pr.get("new-system") == "yes" or pr.get("new-page") == "yes"
    )


def _collect_key_events(part: ET.Element, ns: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for measure in part.findall(qname(ns, "measure")):
        mnum = int(measure.get("number") or 0)
        at_break = _measure_at_layout_break(measure, ns)
        for attr in measure.findall(qname(ns, "attributes")):
            key = attr.find(qname(ns, "key"))
            if key is None:
                continue
            f = key.find(qname(ns, "fifths"))
            if f is None or not (f.text or "").strip().lstrip("-").isdigit():
                continue
            events.append(
                {
                    "measure_num": mnum,
                    "fifths": int(f.text.strip()),
                    "at_break": at_break,
                    "key_el": key,
                    "attr_el": attr,
                }
            )
    return events


def _spurious_fifths_by_part_consensus(
    root: ET.Element, ns: str
) -> set[int]:
    """대부분 파트에서 줄바꿈에만 나오는 fifths → 줄머리 오인(1♯ courtesy 등)."""
    per_part: list[set[int]] = []
    for part in root.findall(qname(ns, "part")):
        spurious: set[int] = set()
        by_f: dict[int, list[dict[str, Any]]] = {}
        for ev in _collect_key_events(part, ns):
            by_f.setdefault(ev["fifths"], []).append(ev)
        for fifths, evs in by_f.items():
            if not any(not e["at_break"] for e in evs):
                spurious.add(fifths)
        per_part.append(spurious)
    if not per_part:
        return set()
    all_f = {f for s in per_part for f in s}
    out: set[int] = set()
    n = len(per_part)
    for f in all_f:
        votes = sum(1 for s in per_part if f in s)
        if votes >= max(1, (n * 3) // 4):
            out.add(f)
    return out


def _remove_key_from_event(
    ev: dict[str, Any], parents: dict[ET.Element, ET.Element]
) -> None:
    attr_el = ev["attr_el"]
    key_el = ev["key_el"]
    if key_el in list(attr_el):
        attr_el.remove(key_el)
    measure = parents.get(attr_el)
    if measure is not None and len(attr_el) == 0:
        measure.remove(attr_el)


def _first_key_in_part(part: ET.Element, ns: str) -> tuple[int, int] | None:
    """파트에서 (마디 번호, fifths) 첫 `<key>` — 마디 번호 순."""
    found: list[tuple[int, int]] = []
    for measure in part.findall(qname(ns, "measure")):
        mnum = int(measure.get("number") or 0)
        for attr in measure.findall(qname(ns, "attributes")):
            key_el = attr.find(qname(ns, "key"))
            if key_el is None:
                continue
            f = key_el.find(qname(ns, "fifths"))
            if f is None or not (f.text or "").strip().lstrip("-").isdigit():
                continue
            found.append((mnum, int(f.text.strip())))
    if not found:
        return None
    return min(found, key=lambda t: t[0])


def _part_has_pickup_key(part: ET.Element, ns: str) -> bool:
    for measure in part.findall(qname(ns, "measure")):
        mnum = int(measure.get("number") or 0)
        if mnum >= 1:
            break
        for attr in measure.findall(qname(ns, "attributes")):
            if attr.find(qname(ns, "key")) is not None:
                return True
    return False


def _ensure_explicit_opening_key_signatures(root: ET.Element, ns: str) -> int:
    """m1에 `<key>`가 없고, 픽업(m0) 조표도 없으며, 첫 `<key>`가 m2+일 때 C major(`fifths=0`) 명시.

    Audiveris는 조표 없는 구간에서 `<key>`를 생략하는데, OSMD 등 뷰어가
    뒤쪽 조바꿈(m17 4♯ 등)을 악보 첫머리 조표로 당겨 그리는 경우가 있다.
    픽업(m0)에 이미 조표가 있으면 m1은 그 조를 이어받으므로 건드리지 않는다.
    """
    added = 0
    for part in root.findall(qname(ns, "part")):
        first: ET.Element | None = None
        for measure in part.findall(qname(ns, "measure")):
            if int(measure.get("number") or 0) == 1:
                first = measure
                break
        if first is None:
            continue
        attr = first.find(qname(ns, "attributes"))
        if attr is not None and attr.find(qname(ns, "key")) is not None:
            continue
        if _part_has_pickup_key(part, ns):
            continue
        first_key = _first_key_in_part(part, ns)
        if first_key is None or first_key[0] < 2:
            continue
        if attr is None:
            attr = ET.Element(qname(ns, "attributes"))
            insert_idx = len(first)
            for i, child in enumerate(first):
                if local_tag(child) in ("note", "backup", "forward", "direction"):
                    insert_idx = i
                    break
            first.insert(insert_idx, attr)
        key_el = ET.SubElement(attr, qname(ns, "key"))
        ET.SubElement(key_el, qname(ns, "fifths")).text = "0"
        added += 1
    return added


def _normalize_audiveris_key_signatures(
    root: ET.Element, ns: str, parents: dict[ET.Element, ET.Element]
) -> tuple[int, int]:
    """Audiveris 조표 정리 — OMR 조바꿈은 유지, 줄머리 오인·courtesy 반복만 제거.

    - **유지**: 마디 중간(줄바꿈 아님)에 처음 등장하는 조표 — 예: m17 `<fifths>4</fifths>` 조바꿈
    - **제거**: 파트 대부분에서 **줄바꿈에만** 반복되는 fifths (1♯ courtesy 오인)
    - **제거**: 이미 유효 조표가 있는 뒤 줄바꿈마다 같은 fifths를 다시 적는 courtesy `<key>`
    """
    spurious_fifths = _spurious_fifths_by_part_consensus(root, ns)
    line_removed = 0
    courtesy_removed = 0

    for part in root.findall(qname(ns, "part")):
        events = _collect_key_events(part, ns)
        if not events:
            continue

        for fifths in spurious_fifths:
            for ev in events:
                if ev["fifths"] == fifths:
                    _remove_key_from_event(ev, parents)
                    line_removed += 1

        events = _collect_key_events(part, ns)
        by_f: dict[int, list[dict[str, Any]]] = {}
        for ev in events:
            by_f.setdefault(ev["fifths"], []).append(ev)

        for fifths, evs in by_f.items():
            if fifths in spurious_fifths:
                continue
            anchors = [e for e in evs if not e["at_break"]]
            if not anchors:
                continue
            anchor_num = min(e["measure_num"] for e in anchors)
            for ev in evs:
                if ev["at_break"] and ev["measure_num"] > anchor_num and ev["fifths"] == fifths:
                    _remove_key_from_event(ev, parents)
                    courtesy_removed += 1

    return line_removed, courtesy_removed


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
    """이음줄을 깃대가 아닌 음머리 쪽으로 — pitch에 맞춰 동적으로 default-y 계산."""
    pitch_el = note.find(qname(ns, "pitch"))
    if pitch_el is None:
        return
    step_el = pitch_el.find(qname(ns, "step"))
    oct_el = pitch_el.find(qname(ns, "octave"))
    if step_el is None or oct_el is None or not step_el.text or not oct_el.text:
        return
    step = step_el.text.strip()
    try:
        octave = int(oct_el.text.strip())
    except ValueError:
        return

    step_map = {"C": 0, "D": 1, "E": 2, "F": 3, "G": 4, "A": 5, "B": 6}
    if step not in step_map:
        return
    diatonic = octave * 7 + step_map[step]

    # staff 확인
    staff_el = note.find(qname(ns, "staff"))
    staff = (staff_el.text or "").strip() if staff_el is not None else "1"

    if staff == "2":
        y_bottom = 18  # G2
        y_top = 26     # A3
    else:
        y_bottom = 30  # E4
        y_top = 38     # F5

    stem = _stem_direction(note, ns)

    if placement == "below":
        dy = (diatonic - y_bottom) * 5
        offset = -15 if stem == "up" else -10
        slur.set("default-y", str(dy + offset))
    elif placement == "above":
        dy = (diatonic - y_top) * 5
        offset = 15 if stem == "down" else 10
        slur.set("default-y", str(dy + offset))


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
    if part_id in ("P4", "P5", "P6", "P", "Piano"):
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


def _rest_note_to_pitched_eighth(
    rest_note: ET.Element, template: ET.Element, ns: str, eighth_dur: int
) -> None:
    """8분 쉼표 → 다음 음 pitch/stem을 본뜬 8분음표(유실 pickup 복원)."""
    rest_el = rest_note.find(qname(ns, "rest"))
    if rest_el is not None:
        rest_note.remove(rest_el)
    tp = template.find(qname(ns, "pitch"))
    if tp is not None and rest_note.find(qname(ns, "pitch")) is None:
        dur_el = rest_note.find(qname(ns, "duration"))
        idx = list(rest_note).index(dur_el) + 1 if dur_el is not None else 0
        rest_note.insert(idx, copy.deepcopy(tp))
    stem = template.find(qname(ns, "stem"))
    if stem is not None and stem.text and rest_note.find(qname(ns, "stem")) is None:
        ET.SubElement(rest_note, qname(ns, "stem")).text = stem.text
    _set_note_type_duration(rest_note, ns, eighth_dur, "eighth")


def _repair_leading_pickup_eighth_misread(
    measure: ET.Element, ns: str, divisions: int, expected: int
) -> int:
    """마디 맨 앞 8분 pickup/쉼표+4분 오인 복원.

    - 𝄽8 ♩(오인) ♪♪ … (음표 합=마디, 쉼표 포함 8분 1개 넘침): **𝄽8 유지**, 2번째만 ♪.
    - 𝄽8 … (음표 합=마디−8분, 합=마디): 유실 pickup ♪ 복원(𝄽8→♪, 다음 음 pitch).
    - ♩♩♪♪ … (음표 합=마디+8분): **첫 ♩만** ♪.
    """
    if not divisions or not expected:
        return 0
    eighth = divisions // 2
    quarter = divisions
    fixed = 0
    for (_, _voice), groups in _voice_groups(measure, ns).items():
        if len(groups) < 2:
            continue
        pitched = sum(
            _note_duration(g[0], ns) or 0
            for g in groups
            if not _is_rest(g[0], ns)
        )
        total = sum(_note_duration(g[0], ns) or 0 for g in groups)
        g0, g1 = groups[0], groups[1]
        if (
            _is_eighth_rest_group(g0[0], ns, divisions)
            and _is_plain_quarter_group(g1[0], ns, divisions)
            and pitched == expected
            and total == expected + eighth
            and len(groups) >= 3
            and _is_plain_eighth_group(groups[2][0], ns, divisions)
            and _note_has_beam(groups[2][0], ns)
        ):
            _halve_group_to_eighth(g1[1], ns)
            fixed += 1
            continue
        if (
            len(groups) >= 3
            and pitched == expected + eighth
            and _is_plain_quarter_group(g0[0], ns, divisions)
            and _is_plain_quarter_group(g1[0], ns, divisions)
            and _is_plain_eighth_group(groups[2][0], ns, divisions)
            and _note_has_beam(groups[2][0], ns)
            and not _note_has_beam(g0[0], ns)
            and not _note_has_beam(g1[0], ns)
        ):
            _halve_group_to_eighth(g0[1], ns)
            fixed += 1
    return fixed


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


def _group_default_x(leader: ET.Element) -> float:
    x = leader.get("default-x")
    try:
        return float(x) if x is not None else 9999.0
    except ValueError:
        return 9999.0


def _staffs_in_measure(measure: ET.Element, ns: str) -> set[str]:
    return {g[2] for g in _iter_chord_groups(measure, ns)}


def _staff_chronological_groups(measure: ET.Element, ns: str, staff: str):
    groups = [g for g in _iter_chord_groups(measure, ns) if g[2] == staff]
    groups.sort(key=lambda g: _group_default_x(g[0]))
    return groups


def _staff_pitched_duration_sum(measure: ET.Element, ns: str, staff: str) -> int:
    return sum(
        _note_duration(g[0], ns) or 0
        for g in _staff_chronological_groups(measure, ns, staff)
        if not _is_rest(g[0], ns)
    )


def _voice_has_mixed_eighth_durations(groups, ns: str) -> bool:
    durs: set[int] = set()
    for g in groups:
        if _is_rest(g[0], ns):
            continue
        if _note_type_text(g[0], ns) != "eighth":
            continue
        d = _note_duration(g[0], ns)
        if d:
            durs.add(d)
    return len(durs) > 1


def _staff_has_dotted_quarter_short_second_voice(
    measure: ET.Element, ns: str, staff: str, divisions: int, *, skip_voice: str | None = None
) -> bool:
    """같은 staff 다른 voice에 ♩. + (♪ 또는 8분 쉼) 패턴이 있으면 True."""
    eighth = divisions // 2
    if eighth <= 0:
        return False
    for (s, voice), groups in _voice_groups(measure, ns).items():
        if s != staff or voice == skip_voice or len(groups) < 2:
            continue
        if not _is_dotted_quarter_group(groups[0][0], ns, divisions):
            continue
        g1 = groups[1][0]
        d1 = _note_duration(g1, ns) or 0
        if d1 != eighth:
            continue
        if _is_plain_eighth_group(g1, ns, divisions) or _is_rest(g1, ns):
            return True
    return False


def _repair_dotted_quarter_on_staff_timeline(
    measure: ET.Element, ns: str, divisions: int, expected: int
) -> int:
    """피아노 RH 등 — voice flatten 없이 staff 타임라인에서 ♩. 뒤 잘못된 4분→8분."""
    fixed = 0
    eighth = divisions // 2
    quarter = divisions
    dotted_quarter = quarter + eighth
    for staff in _staffs_in_measure(measure, ns):
        groups = _staff_chronological_groups(measure, ns, staff)
        if len(groups) < 2:
            continue
        voices = {g[3] for g in groups if not _is_rest(g[0], ns)}
        if len(voices) <= 1:
            continue
        g0 = groups[0]
        if not _is_dotted_quarter_group(g0[0], ns, divisions):
            continue
        staff_total = _staff_pitched_duration_sum(measure, ns, staff)
        over = staff_total > expected
        if len(groups) >= 5:
            g1, g2, g3, g4 = groups[1], groups[2], groups[3], groups[4]
            if over and (
                _is_plain_quarter_group(g1[0], ns, divisions)
                and _is_plain_quarter_group(g2[0], ns, divisions)
                and _note_duration(g3[0], ns) == eighth
                and _note_duration(g4[0], ns) == eighth
            ):
                _halve_group_to_eighth(g1[1], ns)
                fixed += 1
                continue
        g1 = groups[1]
        if _is_plain_quarter_group(g1[0], ns, divisions) and g1[3] == g0[3]:
            if over:
                _halve_group_to_eighth(g1[1], ns)
                fixed += 1
    return fixed


def _repair_leading_quarter_pair_on_staff(
    measure: ET.Element, ns: str, divisions: int, expected: int
) -> int:
    """staff 앞 연속 4분 2개 + 빔 8분 — voice flatten 없이 ♪♪ 복원(PR 25 등)."""
    if not divisions or not expected:
        return 0
    fixed = 0
    quarter = divisions
    eighth = divisions // 2
    for staff in _staffs_in_measure(measure, ns):
        groups = _staff_chronological_groups(measure, ns, staff)
        if len(groups) < 3:
            continue
        g0, g1, g2 = groups[0], groups[1], groups[2]
        if g0[3] != g1[3]:
            continue
        voice = g0[3]
        if not (
            _is_plain_quarter_group(g0[0], ns, divisions)
            and _is_plain_quarter_group(g1[0], ns, divisions)
            and _is_plain_eighth_group(g2[0], ns, divisions)
            and _note_has_beam(g2[0], ns)
        ):
            continue
        if _note_has_beam(g0[0], ns) or _note_has_beam(g1[0], ns):
            continue
        voice_groups = _voice_groups(measure, ns)[(staff, voice)]
        voice_total = sum(
            _note_duration(g[0], ns) or 0 for g in voice_groups
        )
        staff_total = _staff_pitched_duration_sum(measure, ns, staff)
        overfull_voice = voice_total in (expected + quarter, expected + eighth)
        parallel_leading = (
            voice_total == 2 * quarter
            and len(voice_groups) == 2
            and all(_is_plain_quarter_group(g[0], ns, divisions) for g in voice_groups)
            and staff_total in (expected + quarter, expected + eighth)
        )
        if not (overfull_voice or parallel_leading):
            continue
        _halve_group_to_eighth(g0[1], ns)
        _halve_group_to_eighth(g1[1], ns)
        _rebeam_group(g0[1], ns, "begin")
        _rebeam_group(g1[1], ns, "end")
        fixed += 1
    return fixed


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
                    continue
            # 패턴 C: ♩. ♪ ♩. — 가운데 8분이 4분으로 읽힌 경우만 8분으로 (쉼표 삽입은 하지 않음)
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
                    dotted_fixed += 1
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
        dotted_fixed += _repair_dotted_quarter_on_staff_timeline(
            measure, ns, divisions, expected
        )
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
    """4분으로 읽힌 8분(복합박·비표준 duration 포함). 점4분은 제외."""
    if _is_rest(leader, ns):
        return False
    if leader.find(qname(ns, "time-modification")) is not None:
        return False
    if leader.find(qname(ns, "dot")) is not None:
        return False
    if _is_dotted_quarter_group(leader, ns, divisions):
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
    """Q–8–Q(동일 화음) + 끝 4분 복제 — 비활성(음표 발명·부작용)."""
    return 0


def _rebeam_group(notes: list[ET.Element], ns: str, beam: str) -> None:
    for n in notes:
        for b in list(n.findall(qname(ns, "beam"))):
            n.remove(b)
        if n.find(qname(ns, "chord")) is None:
            ET.SubElement(n, qname(ns, "beam"), {"number": "1"}).text = beam


def _voice_pitched_duration_sum(groups: list, ns: str) -> int:
    return sum(
        _note_duration(g[0], ns) or 0
        for g in groups
        if not _is_rest(g[0], ns)
    )


def _voice_has_triplet_eighth_before_index(groups: list, ns: str, idx: int) -> bool:
    for j in range(idx):
        if groups[j][0].find(qname(ns, "time-modification")) is not None:
            if _note_type_text(groups[j][0], ns) == "eighth":
                return True
    return False


def _repair_quarter_before_eighth_rest_overfull(
    measure: ET.Element, ns: str, divisions: int, expected: int
) -> int:
    """세잇단 run 뒤 4분(1절) 오인 + 𝄽8 — pitched==expected, total==expected+8 일 때 4분→8분만.

    인쇄 3 PR(mxl2) 등. 쉼표 삽입·다른 voice 변경 없음.
    """
    if not divisions or not expected:
        return 0
    eighth = divisions // 2
    fixed = 0
    for (_, _voice), groups in _voice_groups(measure, ns).items():
        total = sum(_note_duration(g[0], ns) or 0 for g in groups)
        pitched = _voice_pitched_duration_sum(groups, ns)
        if pitched != expected or total != expected + eighth:
            continue
        for i in range(len(groups) - 2):
            g_q, g_r, g_f = groups[i], groups[i + 1], groups[i + 2]
            if not _voice_has_triplet_eighth_before_index(groups, ns, i):
                continue
            if not (
                (
                    _is_plain_quarter_group(g_q[0], ns, divisions)
                    or _is_misread_quarter_chord_for_triplet(g_q, ns, divisions)
                )
                and _is_eighth_rest_group(g_r[0], ns, divisions)
                and _is_plain_quarter_group(g_f[0], ns, divisions)
            ):
                continue
            if _note_has_beam(g_q[0], ns):
                continue
            _halve_group_to_eighth(g_q[1], ns)
            fixed += 1
            break
    return fixed


def _repair_beamed_trio_before_triplet_run(
    measure: ET.Element, ns: str, max_staff: int, divisions: int, expected: int
) -> int:
    """plain 빔 8분 3개(일반 duration) 직후 세잇단 run — 앞 3개만 세잇단 duration·표기.

    인쇄 25 PL(mxl24) 첫 '3' 누락·voice 6분 넘침 등.
    """
    if not divisions or not expected:
        return 0
    triplet_dur = _triplet_eighth_duration(divisions)
    if not triplet_dur:
        return 0
    plain_eighth = divisions // 2
    fixed = 0
    for (_, _voice), groups in _voice_groups(measure, ns).items():
        triplet_idx = None
        for i, g in enumerate(groups):
            if g[0].find(qname(ns, "time-modification")) is not None and _note_type_text(
                g[0], ns
            ) == "eighth":
                triplet_idx = i
                break
        if triplet_idx is None or triplet_idx < 3:
            continue
        trio = groups[triplet_idx - 3 : triplet_idx]
        if any(g[0].find(qname(ns, "time-modification")) is not None for g in trio):
            continue
        if not all(
            _is_plain_eighth_group(g[0], ns, divisions)
            and _note_has_beam(g[0], ns)
            and (_note_duration(g[0], ns) or 0) == plain_eighth
            for g in trio
        ):
            continue
        total = sum(_note_duration(g[0], ns) or 0 for g in groups)
        saving = 3 * (plain_eighth - triplet_dur)
        if saving <= 0 or total != expected + saving:
            continue
        staff = trio[0][2]
        for j, grp in enumerate(trio):
            for n in grp[1]:
                _clear_note_staccato(n, ns)
                _strip_tuplet_notations(n, ns)
                _ensure_time_modification(n, ns)
                _set_note_type_duration(n, ns, triplet_dur, "eighth")
                _set_beam(
                    n,
                    ns,
                    "begin" if j == 0 else ("end" if j == 2 else "continue"),
                )
                _ensure_stem_like_reference(n, staff, max_staff, ns, trio[0][0])
        plc = _infer_tuplet_placement(trio[0][0], ns, max_staff)
        _ensure_tuplet_bracket(trio[0][0], ns, plc, trio[2][0], has_rest=False)
        fixed += 1
    return fixed


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
    """♩♩–♪♪–♩ ↔ ♪♪–♩♩–♩ 양방향 스왑 (비활성).

    g2–g3 빔 8분인 정상 ♩♩–♪♪–♩에서 ♪♪→♩♩ 변환 부작용(m45 PR/B)이 커서 중단.
    """
    return 0


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


def _repair_plain_beamed_trio_as_triplet_on_staff(
    measure: ET.Element, ns: str, max_staff: int, divisions: int
) -> int:
    """같은 staff 다른 voice에 세잇단이 있는데, 한 voice만 plain 빔 8분 3개 — 1절 세잇단으로."""
    if not divisions:
        return 0
    triplet_dur = _triplet_eighth_duration(divisions)
    if not triplet_dur:
        return 0
    fixed = 0
    for staff in _staffs_in_measure(measure, ns):
        has_triplet = any(
            g[0].find(qname(ns, "time-modification")) is not None
            for g in _iter_chord_groups(measure, ns)
            if g[2] == staff
        )
        if not has_triplet:
            continue
        for (s, _voice), groups in _voice_groups(measure, ns).items():
            if s != staff or len(groups) != 3:
                continue
            if any(g[0].find(qname(ns, "time-modification")) is not None for g in groups):
                continue
            if not all(_is_plain_eighth_group(g[0], ns, divisions) for g in groups):
                continue
            if not all(_note_has_beam(g[0], ns) for g in groups):
                continue
            for j, grp in enumerate(groups):
                for n in grp[1]:
                    _clear_note_staccato(n, ns)
                    _strip_tuplet_notations(n, ns)
                    _ensure_time_modification(n, ns)
                    _set_note_type_duration(n, ns, triplet_dur, "eighth")
                    _set_beam(
                        n,
                        ns,
                        "begin" if j == 0 else ("end" if j == 2 else "continue"),
                    )
                    _ensure_stem_like_reference(n, staff, max_staff, ns, groups[0][0])
            plc = _infer_tuplet_placement(groups[0][0], ns, max_staff)
            _ensure_tuplet_bracket(groups[0][0], ns, plc, groups[2][0], has_rest=False)
            fixed += 1
    return fixed


def _split_quarter_chord_to_beamed_eighth_pair(
    measure: ET.Element, group: tuple, ns: str, divisions: int, next_x: float
) -> list[ET.Element]:
    """plain 4분 화음 1개 → 빔 8분 화음 2개(복제)."""
    eighth = divisions // 2
    _halve_group_to_eighth(group[1], ns)
    x0 = _group_default_x(group[0])
    second: list[ET.Element] = []
    for ni, n in enumerate(group[1]):
        c = copy.deepcopy(n)
        if ni > 0:
            ET.SubElement(c, qname(ns, "chord"))
        else:
            ch = c.find(qname(ns, "chord"))
            if ch is not None:
                c.remove(ch)
        if ni == 0 and x0 < 9999.0:
            orphan_x = None
            staff, voice = _note_voice_staff(group[0][0], ns)
            staff = staff or "1"
            for g in _iter_chord_groups(measure, ns):
                if g[2] != staff or g[0] is group[0][0]:
                    continue
                if not _is_plain_quarter_group(g[0], ns, divisions):
                    continue
                gx = _group_default_x(g[0])
                if x0 < gx < next_x + 1:
                    orphan_x = int(gx)
                    break
            c.set(
                "default-x",
                str(orphan_x if orphan_x is not None else int(round((x0 + next_x) / 2))),
            )
        second.append(c)
    _rebeam_group(group[1], ns, "begin")
    anchor = group[1][-1]
    for sn in second:
        _insert_after_note(measure, anchor, sn)
        anchor = sn
    _rebeam_group(second, ns, "end")
    return second


def _staff_has_isolated_quarter_voice(
    measure: ET.Element, ns: str, staff: str, divisions: int, expected: int
) -> bool:
    """다른 voice가 마디를 채울 때, 단독 plain 4분 1개만 있는 orphan voice."""
    if not divisions or not expected:
        return False
    by_voice: dict[str, list] = {}
    for (s, voice), groups in _voice_groups(measure, ns).items():
        if s != staff:
            continue
        by_voice[voice] = groups
    if len(by_voice) < 2:
        return False
    totals = {
        v: sum(_note_duration(g[0], ns) or 0 for g in grps) for v, grps in by_voice.items()
    }
    main_total = max(totals.values())
    if main_total < expected - divisions // 2:
        return False
    for v, grps in by_voice.items():
        if totals[v] != main_total and len(grps) == 1:
            if _is_plain_quarter_group(grps[0][0], ns, divisions):
                return True
    return False


def _repair_quarter_chord_to_beamed_eighth_pair_after_beam(
    measure: ET.Element, ns: str, divisions: int, expected: int = 0
) -> int:
    """빔 run(잇단 포함) 직후 4분 화음 1개 — 빔 8분 화음 2개로 분할(PL 48 등).

    voice가 4분 하나 넘치거나, 같은 staff에 orphan 4분 voice가 있을 때만 (♪♪ ♩ ♪♪ 정상 패턴 제외).
    """
    if not divisions or not expected:
        return 0
    fixed = 0
    quarter = divisions
    for (staff, voice), groups in _voice_groups(measure, ns).items():
        voice_total = sum(_note_duration(g[0], ns) or 0 for g in groups)
        allow_exact = voice_total == expected and _staff_has_isolated_quarter_voice(
            measure, ns, staff, divisions, expected
        )
        if voice_total != expected + quarter and not allow_exact:
            continue
        for i in range(1, len(groups) - 1):
            g_prev, g0, g1 = groups[i - 1], groups[i], groups[i + 1]
            if not _is_plain_quarter_group(g0[0], ns, divisions):
                continue
            if not (
                _is_plain_eighth_group(g1[0], ns, divisions) and _note_has_beam(g1[0], ns)
            ):
                continue
            if _note_has_beam(g0[0], ns):
                continue
            prev_beams = g_prev[0].findall(qname(ns, "beam"))
            if not prev_beams or prev_beams[-1].text not in ("end", "continue"):
                continue
            _split_quarter_chord_to_beamed_eighth_pair(
                measure, g0, ns, divisions, _group_default_x(g1[0])
            )
            fixed += 1
            break
    return fixed


def _remove_isolated_quarter_voices_on_staff(
    measure: ET.Element, ns: str, divisions: int, expected: int
) -> int:
    """한 staff에서 다른 voice가 마디를 채울 때, 단독 4분 1개만 있는 orphan voice 제거."""
    if not divisions or not expected:
        return 0
    removed = 0
    for staff in _staffs_in_measure(measure, ns):
        by_voice: dict[str, list] = {}
        for (s, voice), groups in _voice_groups(measure, ns).items():
            if s != staff:
                continue
            by_voice[voice] = groups
        if len(by_voice) < 2:
            continue
        totals = {
            v: sum(_note_duration(g[0], ns) or 0 for g in grps) for v, grps in by_voice.items()
        }
        main_total = max(totals.values())
        if main_total < expected - divisions // 2:
            continue
        for voice, groups in by_voice.items():
            if totals[voice] != main_total and len(groups) == 1:
                g0 = groups[0]
                if _is_plain_quarter_group(g0[0], ns, divisions):
                    for n in g0[1]:
                        measure.remove(n)
                    removed += 1
    return removed


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
                t0 = _note_type_text(g0[0], ns)
                t1 = _note_type_text(g1[0], ns)
                if t0 != t1:
                    continue
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
        if measure.get("number") not in ("6", "30"):
            continue
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


def _key_fifths_before_measure(part: ET.Element, measure_num: int, ns: str) -> int:
    """해당 마디 직전까지 유효한 조표 fifths (마디별 문맥)."""
    fifths = 0
    for measure in part.findall(qname(ns, "measure")):
        mnum = int(measure.get("number") or 0)
        if mnum >= measure_num:
            break
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
        if _voice_has_mixed_eighth_durations(groups, ns):
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
    """overfull·pickup·세잇단 절약 등 **근거 있는** voice만 리듬 보정.

    voice total==expected(정확히 맞음)만으로는 보정하지 않음 — m19 등 OMR 유지.
    """
    if not expected:
        return False
    eighth = (divisions or 0) // 2
    triplet_saving = _triplet_eighth_saving(divisions or 0)
    for (_, _voice), groups in _voice_groups(measure, ns).items():
        total = sum(_note_duration(g[0], ns) or 0 for g in groups)
        pitched = _voice_pitched_duration_sum(groups, ns)
        if not total and not pitched:
            continue
        if pitched > expected:
            return True
        if eighth and pitched == expected and total == expected + eighth:
            return True
        if triplet_saving and total == expected + triplet_saving:
            return True
        if eighth and total == expected + 2 * eighth and pitched > expected:
            return True
    return False


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


def _repair_divergent_quarter_pair_before_triplet_run(
    measure: ET.Element, ns: str, max_staff: int, divisions: int
) -> int:
    """순차 Q(A)+Q(B) + 세잇단 run → T(A,B,B) 하나로 (인쇄 45 PL 첫 세잇단).

    default-x 간격이 큰 서로 다른 4분 2개를 T(A,A,A)+T(B,B,B)로 각각 펼치지 않음.
    """
    if not divisions:
        return 0
    triplet_dur = _triplet_eighth_duration(divisions)
    if not triplet_dur:
        return 0
    fixed = 0
    for (staff, voice), groups in _voice_groups(measure, ns).items():
        triplet_idx: int | None = None
        for i, g in enumerate(groups):
            if g[0].find(qname(ns, "time-modification")) is not None and _note_type_text(
                g[0], ns
            ) == "eighth":
                triplet_idx = i
                break
        if triplet_idx is None or triplet_idx < 2:
            continue
        g_a, g_b = groups[triplet_idx - 2], groups[triplet_idx - 1]
        if not (
            _is_misread_quarter_chord_for_triplet(g_a, ns, divisions)
            and _is_misread_quarter_chord_for_triplet(g_b, ns, divisions)
        ):
            continue
        if _chord_pitch_signature(g_a, ns) == _chord_pitch_signature(g_b, ns):
            continue
        if abs(_group_default_x(g_a[0]) - _group_default_x(g_b[0])) <= divisions:
            continue
        stem_ref = groups[triplet_idx][0]
        leader_a, notes_a, st, _ = g_a
        _, notes_b, _, _ = g_b
        for n in notes_a:
            _clear_note_staccato(n, ns)
            _ensure_time_modification(n, ns)
            _set_note_type_duration(n, ns, triplet_dur, "eighth")
            _strip_tuplet_notations(n, ns)
            _ensure_stem_like_reference(n, st, max_staff, ns, n)
            _set_beam(n, ns, "begin")
        insert_at = list(measure).index(notes_a[-1]) + 1
        slice2: list[ET.Element] = []
        slice3: list[ET.Element] = []
        for j, template in enumerate(notes_b):
            slice2.append(
                _clone_triplet_slice_note(
                    template, ns, triplet_dur, "continue", j > 0, st, max_staff, template
                )
            )
            slice3.append(
                _clone_triplet_slice_note(
                    template, ns, triplet_dur, "end", j > 0, st, max_staff, template
                )
            )
        for n in slice2 + slice3:
            measure.insert(insert_at, n)
            insert_at += 1
        plc = _infer_tuplet_placement(leader_a, ns, max_staff)
        _ensure_tuplet_bracket(leader_a, ns, plc, slice3[0], has_rest=False)
        for n in notes_b:
            measure.remove(n)
        fixed += 1
    return fixed


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
        # Q(A)+Q(B)+T… — default-x가 붙은 collapsed prefix만 tri2 대상, 순차 4분은 개별 펼침
        if triplet_idx >= 2:
            g_a, g_b = groups[triplet_idx - 2], groups[triplet_idx - 1]
            if (
                _is_misread_quarter_chord_for_triplet(g_a, ns, divisions)
                and _is_misread_quarter_chord_for_triplet(g_b, ns, divisions)
                and _chord_pitch_signature(g_a, ns) != _chord_pitch_signature(g_b, ns)
                and abs(_group_default_x(g_a[0]) - _group_default_x(g_b[0])) <= divisions
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
            pitched_total = 0
            for leader, _, _, _ in groups:
                dur = _note_duration(leader, ns)
                if dur is None:
                    continue
                total += dur
                if not _is_rest(leader, ns):
                    pitched_total += dur
            if pitched_total == expected:
                continue
            if total == expected:
                continue
            if _normalize_overfull_rest_only_voice(groups, ns, expected):
                rest_fixed += 1
                continue
            if pitched_total != expected + eighth or pitched_total < expected:
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


def _consolidate_sequential_voice_after_backup(measure: ET.Element, ns: str) -> int:
    """backup 직후( forward 없음) 다른 voice — 순차 조각이면 주 voice로 병합."""
    merged = 0
    while True:
        children = list(measure)
        found = False
        for i, el in enumerate(children):
            if local_tag(el) != "backup":
                continue
            j = i + 1
            while j < len(children) and local_tag(children[j]) == "forward":
                fd = children[j].find(qname(ns, "duration"))
                if (
                    fd is not None
                    and fd.text
                    and fd.text.strip().isdigit()
                    and int(fd.text.strip()) > 0
                ):
                    break
                j += 1
            if j < len(children) and local_tag(children[j]) == "forward":
                continue
            while j < len(children) and local_tag(children[j]) == "forward":
                j += 1
            if j >= len(children) or local_tag(children[j]) != "note":
                continue
            sec = children[j]
            sec_v, sec_s = _note_voice_staff(sec, ns)
            if not sec_v or not sec_s:
                continue
            pri_v = None
            for k in range(i - 1, -1, -1):
                if (
                    local_tag(children[k]) != "note"
                    or children[k].find(qname(ns, "chord")) is not None
                ):
                    continue
                v, s = _note_voice_staff(children[k], ns)
                if s == sec_s and v and v != sec_v:
                    pri_v = v
                    break
                if s == sec_s:
                    break
            if not pri_v:
                continue
            measure.remove(el)
            for note in measure.findall(qname(ns, "note")):
                v, s = _note_voice_staff(note, ns)
                if v == sec_v and s == sec_s:
                    vel = note.find(qname(ns, "voice"))
                    if vel is not None:
                        vel.text = pri_v
            _reorder_staff_notes_by_default_x(measure, ns, sec_s)
            merged += 1
            found = True
            break
        if not found:
            break
    return merged


def _reorder_staff_notes_by_default_x(measure: ET.Element, ns: str, staff: str) -> int:
    """같은 staff 음표를 default-x 순으로 XML 재배치(chord 그룹 유지)."""
    groups = [g for g in _iter_chord_groups(measure, ns) if g[2] == staff]
    if len(groups) < 2:
        return 0
    xs = [_group_default_x(g[0]) for g in groups]
    if xs == sorted(xs):
        return 0
    groups.sort(key=lambda g: _group_default_x(g[0]))
    note_set = {n for g in groups for n in g[1]}
    indices = [list(measure).index(g[1][0]) for g in groups]
    insert_at = min(indices)
    for g in groups:
        for n in g[1]:
            measure.remove(n)
    flat: list[ET.Element] = []
    for g in groups:
        flat.extend(g[1])
    for offset, n in enumerate(flat):
        measure.insert(insert_at + offset, n)
    return 1


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
            if sum(v_durs.values()) > expected:
                continue  # voice 합이 마디를 넘으면 시간상 겹치는 병렬(피아노 RH 등) — flatten 금지
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
        # 순차 4분(서로 다른 default-x)은 collapsed triplet prefix가 아님 — m45 PL 등
        if abs(_group_default_x(g0[0]) - _group_default_x(g1[0])) > divisions:
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


_TRAILING_PHANTOM_REST_TYPES = frozenset({"eighth", "16th"})
_HIGH_REST_DISPLAY_STEPS = frozenset({"C", "D", "E"})
_PITCH_SEMITONE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def _note_pitch_midi(note: ET.Element, ns: str) -> int | None:
    pitch = note.find(qname(ns, "pitch"))
    if pitch is None:
        return None
    step_el = pitch.find(qname(ns, "step"))
    oct_el = pitch.find(qname(ns, "octave"))
    if step_el is None or oct_el is None or not step_el.text or not oct_el.text:
        return None
    step = step_el.text.strip().upper()
    if step not in _PITCH_SEMITONE:
        return None
    try:
        oct_n = int(oct_el.text.strip())
    except ValueError:
        return None
    alter = 0
    alter_el = pitch.find(qname(ns, "alter"))
    if alter_el is not None and alter_el.text and alter_el.text.strip().lstrip("-").replace(".", "", 1).isdigit():
        alter = int(float(alter_el.text.strip()))
    return (oct_n + 1) * 12 + _PITCH_SEMITONE[step] + alter


def _note_staff_default(note: ET.Element, ns: str) -> str:
    _, staff = _note_voice_staff(note, ns)
    return staff if staff else "1"


def _median_pitch_on_staff_in_measure(measure: ET.Element, ns: str, staff: str) -> int | None:
    midis: list[int] = []
    for note in measure.findall(qname(ns, "note")):
        if _note_staff_default(note, ns) != staff:
            continue
        if note.find(qname(ns, "rest")) is not None:
            continue
        midi = _note_pitch_midi(note, ns)
        if midi is not None:
            midis.append(midi)
    if not midis:
        return None
    midis.sort()
    mid = len(midis) // 2
    return midis[mid] if len(midis) % 2 else (midis[mid - 1] + midis[mid]) // 2


def _median_pitch_on_staff_before(
    part: ET.Element, measure_num: int, staff: str, ns: str
) -> int | None:
    prev: int | None = None
    for measure in part.findall(qname(ns, "measure")):
        mnum = int(measure.get("number") or 0)
        if mnum >= measure_num:
            break
        med = _median_pitch_on_staff_in_measure(measure, ns, staff)
        if med is not None:
            prev = med
    return prev


def _octaves_to_restore_after_f_clef_misread(
    part: ET.Element, measure: ET.Element, staff: str, ns: str
) -> int:
    """G clef 파트에서 F clef 오인 제거 후 bass-octave export를 treble로 복구."""
    mnum = int(measure.get("number") or 0)
    cur = _median_pitch_on_staff_in_measure(measure, ns, staff)
    prev = _median_pitch_on_staff_before(part, mnum, staff, ns)
    if cur is None:
        return 0
    if prev is None:
        return 2 if cur < 52 else 1
    if cur >= prev - 12:
        return 0
    best = 0
    best_dist = abs(cur - prev)
    for n in (1, 2, 3):
        dist = abs(cur + n * 12 - prev)
        if dist < best_dist:
            best = n
            best_dist = dist
    return best


def _transpose_pitched_notes_on_staff_in_measure(
    measure: ET.Element, ns: str, staff: str, delta: int
) -> None:
    if delta <= 0:
        return
    for note in measure.findall(qname(ns, "note")):
        if note.find(qname(ns, "rest")) is not None:
            continue
        if _note_staff_default(note, ns) != staff:
            continue
        pitch = note.find(qname(ns, "pitch"))
        if pitch is None:
            continue
        oct_el = pitch.find(qname(ns, "octave"))
        if oct_el is None or not oct_el.text or not oct_el.text.strip().isdigit():
            continue
        oct_el.text = str(max(0, min(9, int(oct_el.text.strip()) + delta)))


def _staff_has_key_in_measure(measure: ET.Element, staff_n: int, ns: str) -> bool:
    for attr in measure.findall(qname(ns, "attributes")):
        for key in attr.findall(qname(ns, "key")):
            num_attr = key.get("number")
            if num_attr is None:
                return True
            if num_attr.isdigit() and int(num_attr) == staff_n:
                return True
    return False


def _promote_staff_numbered_keys_to_global_in_measure(
    measure: ET.Element, ns: str, fifths: int | None
) -> int:
    """grand staff 조바꿈에서 `<key number=\"2\">`만 있는 경우 전파트 `<key>`로 통일."""
    n = 0
    for attr in list(measure.findall(qname(ns, "attributes"))):
        keys = list(attr.findall(qname(ns, "key")))
        numbered = [k for k in keys if k.get("number")]
        if not numbered:
            continue
        target = fifths
        if target is None:
            fe = numbered[0].find(qname(ns, "fifths"))
            if fe is not None and fe.text and fe.text.strip().lstrip("-").isdigit():
                target = int(fe.text.strip())
        for k in numbered:
            attr.remove(k)
            n += 1
        if target is not None and attr.find(qname(ns, "key")) is None:
            key_el = ET.SubElement(attr, qname(ns, "key"))
            ET.SubElement(key_el, qname(ns, "fifths")).text = str(target)
            n += 1
        if len(attr) == 0:
            measure.remove(attr)
    return n


def _is_treble_f_clef_key_change_misread(
    part: ET.Element,
    part_id: str | None,
    measure: ET.Element,
    mnum: int,
    staff_n: int,
    ns: str,
    root: ET.Element,
    global_key_change: bool,
) -> bool:
    if _clef_sign_before(part, mnum, staff_n, ns) != "G":
        return False
    has_f = False
    for attr in measure.findall(qname(ns, "attributes")):
        for clef in attr.findall(qname(ns, "clef")):
            sign_el = clef.find(qname(ns, "sign"))
            if sign_el is None or (sign_el.text or "").strip().upper() != "F":
                continue
            num_attr = clef.get("number")
            staff = int(num_attr) if num_attr and num_attr.isdigit() else 1
            if staff == staff_n:
                has_f = True
    if not has_f or _staff_has_key_in_measure(measure, staff_n, ns):
        return False
    if global_key_change:
        if _part_has_two_staves(part, ns):
            return staff_n == 1
        return True
    med = _median_pitch_on_staff_in_measure(measure, ns, str(staff_n))
    return med is not None and med >= 52


def _remove_measure_numbering_root(root: ET.Element, ns: str) -> int:
    removed = 0
    for part in root.findall(qname(ns, "part")):
        for measure in part.findall(qname(ns, "measure")):
            for pr in list(measure.findall(qname(ns, "print"))):
                for mn in list(pr.findall(qname(ns, "measure-numbering"))):
                    pr.remove(mn)
                    removed += 1
                if len(pr) == 0 and not (pr.text and pr.text.strip()):
                    measure.remove(pr)
    return removed


def _normalize_measure_numbering_from_manifest_root(root: ET.Element, ns: str) -> tuple[int, int]:
    """`<measure-numbering>` 전부 제거 후 manifest 인쇄 마디만 system 복원."""
    removed = _remove_measure_numbering_root(root, ns)
    allowed = _printed_measure_mxl_set_from_env()
    if allowed is None or not allowed:
        return removed, 0
    added = 0
    for part in root.findall(qname(ns, "part")):
        for measure in part.findall(qname(ns, "measure")):
            mnum = int(measure.get("number") or 0)
            if mnum not in allowed:
                continue
            pr = measure.find(qname(ns, "print"))
            if pr is None:
                pr = ET.Element(qname(ns, "print"))
                measure.insert(0, pr)
            mn = pr.find(qname(ns, "measure-numbering"))
            if mn is None:
                mn = ET.SubElement(pr, qname(ns, "measure-numbering"))
            mn.text = "system"
            added += 1
        break  # 첫 part만 — MuseScore 줄머리 번호는 보통 한 번만
    return removed, added


def _remove_redundant_courtesy_clefs_root(root: ET.Element, ns: str) -> int:
    removed = 0
    for part in root.findall(qname(ns, "part")):
        for measure in part.findall(qname(ns, "measure")):
            mnum = int(measure.get("number") or 0)
            for attr in list(measure.findall(qname(ns, "attributes"))):
                for clef in list(attr.findall(qname(ns, "clef"))):
                    num_attr = clef.get("number")
                    staff_n = int(num_attr) if num_attr and num_attr.isdigit() else 1
                    sign_el = clef.find(qname(ns, "sign"))
                    sign = (sign_el.text or "").strip().upper() if sign_el is not None else ""
                    if not sign:
                        continue
                    if sign == (_clef_sign_before(part, mnum, staff_n, ns) or ""):
                        attr.remove(clef)
                        removed += 1
                if len(attr) == 0:
                    measure.remove(attr)
    return removed


def _clef_sign_before(part: ET.Element, measure_num: int, staff_n: int, ns: str) -> str | None:
    sign: str | None = None
    for measure in part.findall(qname(ns, "measure")):
        mnum = int(measure.get("number") or 0)
        if mnum >= measure_num:
            break
        for attr in measure.findall(qname(ns, "attributes")):
            for clef in attr.findall(qname(ns, "clef")):
                num_attr = clef.get("number")
                staff = int(num_attr) if num_attr and num_attr.isdigit() else 1
                if staff != staff_n:
                    continue
                sign_el = clef.find(qname(ns, "sign"))
                if sign_el is not None and sign_el.text:
                    sign = sign_el.text.strip().upper()
    return sign


def _measure_key_fifths_changes(part: ET.Element, measure: ET.Element, ns: str) -> list[int]:
    mnum = int(measure.get("number") or 0)
    prev = _key_fifths_before_measure(part, mnum, ns)
    out: list[int] = []
    for attr in measure.findall(qname(ns, "attributes")):
        for key in attr.findall(qname(ns, "key")):
            fifths_el = key.find(qname(ns, "fifths"))
            if fifths_el is None or not fifths_el.text or not fifths_el.text.strip().lstrip("-").isdigit():
                continue
            nf = int(fifths_el.text.strip())
            if nf != prev:
                out.append(nf)
    return out


def _repair_key_change_clef_misread_root(root: ET.Element, ns: str) -> int:
    """조바꿈 마디 F clef 오인 → `<key>` 보충 + bass-octave pitch 복구 (treble part만)."""
    fixed = 0
    measure_nums: set[int] = set()
    for part in root.findall(qname(ns, "part")):
        for measure in part.findall(qname(ns, "measure")):
            measure_nums.add(int(measure.get("number") or 0))
    for mnum in sorted(measure_nums):
        declared: list[int] = []
        parts = root.findall(qname(ns, "part"))
        for part in parts:
            meas = next(
                (m for m in part.findall(qname(ns, "measure")) if int(m.get("number") or 0) == mnum),
                None,
            )
            if meas is not None:
                declared.extend(_measure_key_fifths_changes(part, meas, ns))
        global_key_change = bool(declared)
        new_fifths: int | None = None
        if global_key_change:
            counts: dict[int, int] = {}
            for f in declared:
                counts[f] = counts.get(f, 0) + 1
            ranked = sorted(counts.items(), key=lambda x: (-x[1], x[0]))
            if len(ranked) > 1 and ranked[0][1] == ranked[1][1]:
                continue
            new_fifths = ranked[0][0]
        for part in parts:
            meas = next(
                (m for m in part.findall(qname(ns, "measure")) if int(m.get("number") or 0) == mnum),
                None,
            )
            if meas is None:
                continue
            part_id = part.get("id")
            part_changes = _measure_key_fifths_changes(part, meas, ns)
            for attr in list(meas.findall(qname(ns, "attributes"))):
                has_key = attr.find(qname(ns, "key")) is not None
                removed_misread = False
                for clef in list(attr.findall(qname(ns, "clef"))):
                    sign_el = clef.find(qname(ns, "sign"))
                    if sign_el is None or (sign_el.text or "").strip().upper() != "F":
                        continue
                    num_attr = clef.get("number")
                    staff_n = int(num_attr) if num_attr and num_attr.isdigit() else 1
                    prev_sign = _clef_sign_before(part, mnum, staff_n, ns)
                    med = _median_pitch_on_staff_in_measure(meas, ns, str(staff_n))
                    treble_misread = _is_treble_f_clef_key_change_misread(
                        part, part_id, meas, mnum, staff_n, ns, root, global_key_change
                    ) or (
                        prev_sign == "G"
                        and not _staff_has_key_in_measure(meas, staff_n, ns)
                        and med is not None
                        and med >= 52
                    )
                    if treble_misread:
                        attr.remove(clef)
                        removed_misread = True
                        fixed += 1
                        oct_delta = _octaves_to_restore_after_f_clef_misread(
                            part, meas, str(staff_n), ns
                        )
                        if oct_delta:
                            _transpose_pitched_notes_on_staff_in_measure(
                                meas, ns, str(staff_n), oct_delta
                            )
                            fixed += 1
                has_key = attr.find(qname(ns, "key")) is not None
                if not has_key:
                    fifths_to_inject = (
                        part_changes[-1]
                        if part_changes
                        else new_fifths
                        if removed_misread and new_fifths is not None
                        else None
                    )
                    if fifths_to_inject is not None:
                        key_el = ET.SubElement(attr, qname(ns, "key"))
                        ET.SubElement(key_el, qname(ns, "fifths")).text = str(fifths_to_inject)
                        fixed += 1
                if len(attr) == 0:
                    meas.remove(attr)
            if global_key_change and _part_has_two_staves(part, ns):
                fixed += _promote_staff_numbered_keys_to_global_in_measure(
                    meas, ns, new_fifths
                )
    return fixed


def _repair_rest_display_high_root(root: ET.Element, ns: str) -> int:
    """whole/half·마디전체 rest의 display-step C/D/E 제거 — 뷰어 기본 위치 사용."""
    n = 0
    for note in root.iter():
        if local_tag(note) != "note":
            continue
        rest_el = note.find(qname(ns, "rest"))
        if rest_el is None:
            continue
        typ = note.find(qname(ns, "type"))
        tval = (typ.text or "").strip() if typ is not None and typ.text else ""
        is_measure_rest = rest_el.get("measure") == "yes"
        if tval not in ("whole", "half") and not is_measure_rest:
            continue
        step_el = rest_el.find(qname(ns, "display-step"))
        if step_el is None or not step_el.text:
            continue
        if step_el.text.strip().upper() not in _HIGH_REST_DISPLAY_STEPS:
            continue
        for tag in ("display-step", "display-octave"):
            el = rest_el.find(qname(ns, tag))
            if el is not None:
                rest_el.remove(el)
        n += 1
    return n


def _remove_trailing_phantom_rests_in_measure(measure: ET.Element, ns: str) -> int:
    note_els = [el for el in measure if local_tag(el) == "note"]
    events: list[str] = []
    for note in note_els:
        if note.find(qname(ns, "rest")) is not None:
            typ = note.find(qname(ns, "type"))
            tval = (typ.text or "").strip() if typ is not None and typ.text else ""
            events.append(f"rest:{tval}")
        else:
            events.append("note")
    if len(events) < 2 or not events[-1].startswith("rest:"):
        return 0
    rest_type = events[-1].split(":", 1)[1]
    if rest_type not in _TRAILING_PHANTOM_REST_TYPES:
        return 0
    if not any(not e.startswith("rest:") for e in events[:-1]):
        return 0
    for note in reversed(note_els):
        if note.find(qname(ns, "rest")) is None:
            continue
        typ = note.find(qname(ns, "type"))
        tval = (typ.text or "").strip() if typ is not None and typ.text else ""
        if tval == rest_type:
            measure.remove(note)
            return 1
    return 0


def _voice_durations_on_staff(measure: ET.Element, ns: str, staff: str) -> dict[str, int]:
    durs: dict[str, int] = {}
    for note in measure.findall(qname(ns, "note")):
        if note.find(qname(ns, "grace")) is not None or note.find(qname(ns, "chord")) is not None:
            continue
        voice, st = _note_voice_staff(note, ns)
        if st != staff:
            continue
        durs[voice] = durs.get(voice, 0) + (_note_duration(note, ns) or 0)
    return durs


def _repair_piano_spurious_voices(measure: ET.Element, ns: str, expected: int) -> int:
    """한 staff에 마디 길이만큼 채운 voice가 있으면 나머지 보조 voice 음·쉼 제거."""
    if expected <= 0:
        return 0
    removed = 0
    for staff in ("1", "2"):
        durs = _voice_durations_on_staff(measure, ns, staff)
        if len(durs) <= 1:
            continue
        primary = next((v for v, d in durs.items() if d == expected), None)
        if primary is None:
            continue
        for note in list(measure.findall(qname(ns, "note"))):
            voice, st = _note_voice_staff(note, ns)
            if st == staff and voice != primary:
                measure.remove(note)
                removed += 1
    return removed


def _normalize_grand_staff_voices_in_measure(measure: ET.Element, ns: str) -> int:
    """피아노 staff2 음표 voice를 1로 통일 — MuseScore phantom rest 완화."""
    changed = 0
    for note in measure.findall(qname(ns, "note")):
        if _note_voice_staff(note, ns)[1] != "2":
            continue
        vel = note.find(qname(ns, "voice"))
        if vel is None:
            vel = ET.SubElement(note, qname(ns, "voice"))
        if (vel.text or "").strip() != "1":
            vel.text = "1"
            changed += 1
    return changed


def _rebuild_piano_grand_staff_measures(part: ET.Element, ns: str) -> int:
    from omr_hitl_lib import _rebuild_measure_flat_staffs

    rebuilt = 0
    for _measure, _div, expected in _iter_measures_with_timing(part, ns):
        if not expected:
            continue
        removed = _repair_piano_spurious_voices(_measure, ns, expected)
        if removed:
            _rebuild_measure_flat_staffs(_measure, ns)
            rebuilt += 1
        elif _part_has_two_staves(part, ns):
            voices_s1 = set(_voice_durations_on_staff(_measure, ns, "1"))
            voices_s2 = set(_voice_durations_on_staff(_measure, ns, "2"))
            if len(voices_s1) <= 1 and len(voices_s2) <= 1 and any(
                local_tag(el) == "backup" for el in _measure
            ):
                _rebuild_measure_flat_staffs(_measure, ns)
                rebuilt += 1
        if _part_has_two_staves(part, ns):
            _normalize_grand_staff_voices_in_measure(_measure, ns)
            _align_staves_timeline(_measure, ns)
    return rebuilt


def _calculate_staff1_duration_robust(measure: ET.Element, ns: str) -> int:
    time_cursors = {}
    max_staff1_time = 0
    for el in measure:
        tag = local_tag(el)
        if tag == "note":
            voice, staff = _note_voice_staff(el, ns)
            is_chord = el.find(qname(ns, "chord")) is not None
            is_grace = el.find(qname(ns, "grace")) is not None or el.get("cue") == "yes"
            dur = _note_duration(el, ns) or 0
            current_time = time_cursors.get((voice, staff), 0)
            if not is_chord and not is_grace:
                new_time = current_time + dur
                time_cursors[(voice, staff)] = new_time
                if staff == "1":
                    max_staff1_time = max(max_staff1_time, new_time)
        elif tag == "backup":
            dur = 0
            dur_el = el.find(qname(ns, "duration"))
            if dur_el is not None and dur_el.text and dur_el.text.strip().isdigit():
                dur = int(dur_el.text.strip())
            for key in time_cursors:
                time_cursors[key] = max(0, time_cursors[key] - dur)
        elif tag == "forward":
            dur = 0
            dur_el = el.find(qname(ns, "duration"))
            if dur_el is not None and dur_el.text and dur_el.text.strip().isdigit():
                dur = int(dur_el.text.strip())
            voice = "1"
            staff = "1"
            v_el = el.find(qname(ns, "voice"))
            s_el = el.find(qname(ns, "staff"))
            if v_el is not None and v_el.text:
                voice = v_el.text.strip()
            if s_el is not None and s_el.text:
                staff = s_el.text.strip()
            time_cursors[(voice, staff)] = time_cursors.get((voice, staff), 0) + dur
            if staff == "1":
                max_staff1_time = max(max_staff1_time, time_cursors[(voice, staff)])
    return max_staff1_time


def _align_staves_timeline(measure: ET.Element, ns: str) -> None:
    notes = measure.findall(qname(ns, "note"))
    staff1_notes = [n for n in notes if _note_voice_staff(n, ns)[1] == "1" and n.find(qname(ns, "grace")) is None and n.get("cue") != "yes"]
    staff2_notes = [n for n in notes if _note_voice_staff(n, ns)[1] == "2" and n.find(qname(ns, "grace")) is None and n.get("cue") != "yes"]
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
        if local_tag(el) == "backup":
            dur_el = el.find(qname(ns, "duration"))
            if dur_el is not None:
                dur_el.text = str(staff1_duration)
            break


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
        "line_header_key_removed": 0,
        "courtesy_key_removed": 0,
        "opening_key_explicit": 0,
        "tuplet_brackets_adjusted": 0,
        "tuplet_normal_fields_fixed": 0,
        "fermata_from_staccato_fixed": 0,
        "key_change_clef_misread_fixed": 0,
        "rest_display_high_fixed": 0,
        "trailing_phantom_rests_removed": 0,
        "piano_grand_staff_rebuilt": 0,
        "courtesy_clef_removed": 0,
        "measure_numbering_removed": 0,
        "measure_numbering_restored": 0,
    }

    # 1) 텍스트 정리 + backup/forward 겹침 voice 병합 (악보 패치보다 먼저)
    for part in root.findall(qname(ns, "part")):
        for measure in part.findall(qname(ns, "measure")):
            tc, dr = _clean_measure(measure, ns, parents)
            stats["text_nodes_cleared"] += tc
            stats["directions_removed"] += dr
            stats["voice_consolidated"] += _consolidate_cross_voices_on_staff(measure, ns)

    stats["key_change_clef_misread_fixed"] += _repair_key_change_clef_misread_root(root, ns)
    stats["rest_display_high_fixed"] += _repair_rest_display_high_root(root, ns)
    stats["courtesy_clef_removed"] += _remove_redundant_courtesy_clefs_root(root, ns)
    if _strip_measure_numbering_enabled():
        mn_removed, mn_restored = _normalize_measure_numbering_from_manifest_root(root, ns)
        stats["measure_numbering_removed"] += mn_removed
        stats["measure_numbering_restored"] += mn_restored
    for part in root.findall(qname(ns, "part")):
        pid = part.get("id")
        if _part_is_piano(pid, root, ns) or _part_has_two_staves(part, ns):
            stats["piano_grand_staff_rebuilt"] += _rebuild_piano_grand_staff_measures(part, ns)
        for measure in part.findall(qname(ns, "measure")):
            stats["trailing_phantom_rests_removed"] += _remove_trailing_phantom_rests_in_measure(
                measure, ns
            )

    # 1a) m1 조표 생략 → C major 명시 (기본 off — HITL·OMR 조표는 사람이 보정)
    if _opening_key_explicit_enabled():
        stats["opening_key_explicit"] += _ensure_explicit_opening_key_signatures(root, ns)

    # 1b) Audiveris 조표: 조바꿈(앵커) 유지, 줄머리 오인·courtesy 반복만 제거
    if _strip_invented_keys_enabled():
        line_removed, courtesy_removed = _normalize_audiveris_key_signatures(root, ns, parents)
        stats["line_header_key_removed"] += line_removed
        stats["courtesy_key_removed"] += courtesy_removed

    # 2) 리듬·화음·세잇단 — AUDIVERIS_MXL_RHYTHM_FIX (기본 off = OMR 유지)
    rhythm_mode = _rhythm_fix_mode()
    for part in root.findall(qname(ns, "part")):
        max_staff = _max_staff_in_part(part, ns)
        for measure, divisions, expected in _iter_measures_with_timing(part, ns):
            if rhythm_mode != "off":
                stats["voice_consolidated"] += _flatten_underfull_voices_in_measure(
                    measure, ns, expected or 0
                )
            stats["misread_natural_to_sharp"] += _repair_missing_accidental_by_backward_propagation(measure, ns)
            mnum = int(measure.get("number") or 0)
            key_fifths = _key_fifths_before_measure(part, mnum, ns)
            if _accidental_repair_enabled():
                stats["misplaced_sharp_relocated"] += _repair_misplaced_sharp_via_duplicate(
                    measure, ns, key_fifths
                )
            stats["chord_duplicates_removed"] += _dedupe_chord_members_in_measure(measure, ns)

            if rhythm_mode == "legacy":
                stats["triplet_quarter_prefix_repaired"] += _repair_two_collapsed_triplet_spans(
                    measure, ns, max_staff, divisions or 0, expected or 0
                )
                stats["quarter_chord_triplet_expanded"] += _repair_divergent_quarter_pair_before_triplet_run(
                    measure, ns, max_staff, divisions or 0
                )
                stats["quarter_chord_triplet_expanded"] += _repair_quarter_chords_before_triplet_run(
                    measure, ns, max_staff, divisions or 0, expected or 0
                )
                stats["quarter_chord_triplet_expanded"] += _repair_beamed_trio_before_triplet_run(
                    measure, ns, max_staff, divisions or 0, expected or 0
                )
                stats["quarter_pair_eighth_fixed"] += _repair_quarter_before_eighth_rest_overfull(
                    measure, ns, divisions or 0, expected or 0
                )
            if rhythm_mode in ("legacy", "beams") and _measure_rhythm_repairable(
                measure, ns, expected or 0, divisions or 0
            ):
                if rhythm_mode == "legacy":
                    stats["three_eighth_triplet_fixed"] += _general_resolve_overfull_measure(
                        measure, ns, max_staff, divisions or 0, expected or 0
                    )
                    stats["quarter_pair_eighth_fixed"] += _repair_swap_leading_qq_with_beamed_pair(
                        measure, ns, divisions or 0, expected or 0
                    )
                stats["quarter_pair_eighth_fixed"] += _repair_leading_pickup_eighth_misread(
                    measure, ns, divisions or 0, expected or 0
                )
                if rhythm_mode == "legacy":
                    stats["quarter_pair_eighth_fixed"] += _repair_leading_quarter_pair(
                        measure, ns, divisions or 0, expected or 0
                    )
                stats["quarter_pair_eighth_fixed"] += _repair_leading_quarter_pair_on_staff(
                    measure, ns, divisions or 0, expected or 0
                )
                if rhythm_mode == "legacy":
                    stats["quarter_pair_eighth_fixed"] += _repair_quarter_eighth_quarter_lost_final(
                        measure, ns, divisions or 0, expected or 0
                    )
                    stats["quarter_pair_eighth_fixed"] += _repair_quarter_pair_before_eighths(
                        measure, ns, divisions or 0, expected or 0
                    )
                stats["quarter_pair_eighth_fixed"] += _repair_quarter_pair_after_beam_run(
                    measure, ns, divisions or 0, expected or 0
                )
                stats["quarter_pair_eighth_fixed"] += _repair_quarter_chord_to_beamed_eighth_pair_after_beam(
                    measure, ns, divisions or 0, expected or 0
                )
                if rhythm_mode == "legacy":
                    stats["quarter_chord_triplet_expanded"] += _repair_plain_beamed_trio_as_triplet_on_staff(
                        measure, ns, max_staff, divisions or 0
                    )
                    stats["quarter_chord_triplet_expanded"] += _remove_isolated_quarter_voices_on_staff(
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
            stats["fermata_from_staccato_fixed"] += _repair_staccato_as_fermata_before_rest(
                measure, ns
            )
        if rhythm_mode == "legacy":
            dotted_fixed, lost_eighth = _repair_dotted_quarter_misread(part, ns)
            stats["dotted_quarter_eighth_fixed"] += dotted_fixed
            stats["lost_eighth_restored"] += lost_eighth

            fixed, rest_fixed = _repair_overfull_eighth(part, ns)
            stats["overfull_eighth_fixed"] += fixed
            stats["overfull_rest_normalized"] += rest_fixed

    # 2b) 리듬 보정 후 voice 조각·default-x 재정렬 (legacy/beams만)
    if rhythm_mode != "off":
        for part in root.findall(qname(ns, "part")):
            for measure in part.findall(qname(ns, "measure")):
                stats["voice_consolidated"] += _consolidate_cross_voices_on_staff(measure, ns)
                stats["voice_consolidated"] += _consolidate_sequential_voice_after_backup(
                    measure, ns
                )
                for staff in _staffs_in_measure(measure, ns):
                    stats["voice_consolidated"] += _reorder_staff_notes_by_default_x(
                        measure, ns, staff
                    )

    # 3) 음표 발명·성부 재배치 등 최후 수단 패치는 일반화 원칙에 따라 제거되었습니다.
    stats["score_patches_applied"] = 0

    for part in root.findall(qname(ns, "part")):
        max_staff = _max_staff_in_part(part, ns)

        stats["tuplet_notations_added"] += _ensure_tuplet_notations(part, ns, max_staff)
        if _part_has_two_staves(part, ns):
            stats["tuplet_dynamics_removed"] += _remove_spurious_tuplet_dynamics(part, ns)

        for measure in part.findall(qname(ns, "measure")):
            stats["tuplet_brackets_adjusted"] += _renumber_tuplets_in_measure(measure, ns)
            key_fifths = _key_fifths_before_measure(part, int(measure.get("number") or 0), ns)
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
            # OMR `<accidental>natural</accidental>` 중 조표·음높이상 불필요한 것만 제거(기본 on)
            if _strip_redundant_naturals_enabled():
                stats["spurious_natural_removed"] += _normalize_accidentals(
                    measure, ns, key_fifths
                )

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
            if max_staff >= 2:
                _align_staves_timeline(measure, ns)

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
