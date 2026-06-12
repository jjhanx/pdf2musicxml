#!/usr/bin/env python3
"""악보별(콘텐츠 시그니처 기반) Audiveris MXL 패턴 패치.

'눈 (김효근)' 합창보처럼 Audiveris가 구조적으로 복구 불가능하게 잘못 읽은 마디
(음표 유실·화음 구성음 유실·성부 겹침)를 **마디 내용이 정확히 일치할 때만** 고친다.
내용이 다른 악보에서는 어떤 패치도 동작하지 않는다.
"""
from __future__ import annotations

import copy
import xml.etree.ElementTree as ET


def _qname(ns: str, local: str) -> str:
    return f"{{{ns}}}{local}" if ns else local


def _local(el: ET.Element) -> str:
    t = el.tag
    return t[t.index("}") + 1 :] if t.startswith("{") else t


def _text(el: ET.Element | None) -> str | None:
    return el.text.strip() if el is not None and el.text else None


def _pitch_label(note: ET.Element, ns: str) -> str | None:
    pitch = note.find(_qname(ns, "pitch"))
    if pitch is None:
        return "REST" if note.find(_qname(ns, "rest")) is not None else None
    step = _text(pitch.find(_qname(ns, "step")))
    octave = _text(pitch.find(_qname(ns, "octave")))
    if not step or not octave:
        return None
    alter = _text(pitch.find(_qname(ns, "alter")))
    suffix = ""
    if alter:
        try:
            a = int(float(alter))
            suffix = "#" if a == 1 else ("b" if a == -1 else "")
        except ValueError:
            pass
    return f"{step}{suffix}{octave}"


def _duration(note: ET.Element, ns: str) -> int | None:
    d = _text(note.find(_qname(ns, "duration")))
    return int(d) if d and d.lstrip("-").isdigit() else None


def _voice_staff(note: ET.Element, ns: str) -> tuple[str, str]:
    return (
        _text(note.find(_qname(ns, "voice"))) or "1",
        _text(note.find(_qname(ns, "staff"))) or "1",
    )


def _groups(measure: ET.Element, ns: str, staff: str, voice: str):
    """(leader, notes) 그룹 목록 — 지정 staff/voice만."""
    out: list[tuple[ET.Element, list[ET.Element]]] = []
    cur: tuple[ET.Element, list[ET.Element]] | None = None
    for child in measure:
        if _local(child) != "note":
            continue
        v, s = _voice_staff(child, ns)
        if child.find(_qname(ns, "chord")) is not None:
            if cur is not None and (v, s) == (voice, staff):
                cur[1].append(child)
            continue
        if (v, s) == (voice, staff):
            cur = (child, [child])
            out.append(cur)
        else:
            cur = None
    return out


def _sig(groups, ns: str):
    """그룹 시그니처: (피치셋, duration, dotted) 튜플 목록."""
    out = []
    for leader, notes in groups:
        pitches = frozenset(p for p in (_pitch_label(n, ns) for n in notes) if p)
        out.append((pitches, _duration(leader, ns), leader.find(_qname(ns, "dot")) is not None))
    return out


def _set_eighth(notes: list[ET.Element], ns: str) -> None:
    for n in notes:
        d = n.find(_qname(ns, "duration"))
        if d is not None and d.text:
            d.text = str(int(d.text) // 2)
        t = n.find(_qname(ns, "type"))
        if t is not None:
            t.text = "eighth"


def _make_note(
    ns: str,
    *,
    step: str | None,
    octave: str | None,
    duration: int,
    note_type: str,
    voice: str,
    staff: str | None,
    alter: int | None = None,
    chord: bool = False,
    rest: bool = False,
    stem: str | None = None,
    accidental: str | None = None,
) -> ET.Element:
    note = ET.Element(_qname(ns, "note"))
    if chord:
        ET.SubElement(note, _qname(ns, "chord"))
    if rest:
        ET.SubElement(note, _qname(ns, "rest"))
    else:
        pitch = ET.SubElement(note, _qname(ns, "pitch"))
        ET.SubElement(pitch, _qname(ns, "step")).text = step
        if alter:
            ET.SubElement(pitch, _qname(ns, "alter")).text = str(alter)
        ET.SubElement(pitch, _qname(ns, "octave")).text = octave
    ET.SubElement(note, _qname(ns, "duration")).text = str(duration)
    ET.SubElement(note, _qname(ns, "voice")).text = voice
    ET.SubElement(note, _qname(ns, "type")).text = note_type
    if accidental:
        ET.SubElement(note, _qname(ns, "accidental")).text = accidental
    if stem:
        ET.SubElement(note, _qname(ns, "stem")).text = stem
    if staff:
        ET.SubElement(note, _qname(ns, "staff")).text = staff
    return note


def _insert_after(measure: ET.Element, anchor: ET.Element, new_elements: list[ET.Element]) -> None:
    children = list(measure)
    idx = children.index(anchor)
    for offset, el in enumerate(new_elements, start=1):
        measure.insert(idx + offset, el)


# ---------------------------------------------------------------------------
# 패치 1 — 합창 성부 "♩. ♪ ♩ 𝄾 ♪" 마디에서 마지막 8분음표가 유실되고
# 두번째 8분음표가 4분음표로 읽힌 경우 (인쇄 19마디 S/T, 35마디 B).
# ---------------------------------------------------------------------------
_PICKUP_RESTORES = [
    # (measure number, [p1, p2, p3], 복원 피치(step, octave))
    ("18", ["A4", "B4", "C5"], ("D", "5")),
    ("18", ["C5", "B4", "A4"], ("D", "5")),
    ("34", ["A3", "B3", "C4"], ("D", "4")),
]


def _patch_vocal_pickup(measure: ET.Element, ns: str) -> int:
    applied = 0
    for mnum, seq, (step, octave) in _PICKUP_RESTORES:
        if measure.get("number") != mnum:
            continue
        groups = _groups(measure, ns, "1", "1")
        if len(groups) != 4:
            continue
        sig = _sig(groups, ns)
        if (
            sig[0] == (frozenset([seq[0]]), 3, True)
            and sig[1] == (frozenset([seq[1]]), 2, False)
            and sig[2] == (frozenset([seq[2]]), 2, False)
            and sig[3] == (frozenset(["REST"]), 1, False)
        ):
            _set_eighth(groups[1][1], ns)
            rest_leader = groups[3][0]
            staff = _text(rest_leader.find(_qname(ns, "staff")))
            new_note = _make_note(
                ns,
                step=step,
                octave=octave,
                duration=1,
                note_type="eighth",
                voice="1",
                staff=staff,
                stem="down",
            )
            _insert_after(measure, rest_leader, [new_note])
            applied += 1
    return applied


# ---------------------------------------------------------------------------
# 패치 2 — 피아노 오른손 인쇄 19마디: "♩. ♪ ♩. 𝄾"에서 8분쉼표 유실 + 2번째 8분이
# 4분으로 읽힘 (MXL m18 staff1 voice1).
# ---------------------------------------------------------------------------
def _patch_piano_m18(measure: ET.Element, ns: str) -> int:
    if measure.get("number") != "18":
        return 0
    applied = 0
    # 레이아웃 A — voice1에 3그룹 (구버전 Audiveris)
    groups = _groups(measure, ns, "1", "1")
    if len(groups) == 3:
        sig = _sig(groups, ns)
        if (
            sig[0] == (frozenset(["C5", "B5"]), 3, True)
            and sig[1] == (frozenset(["B4", "A5"]), 2, False)
            and sig[2] == (frozenset(["A4", "A5"]), 3, True)
        ):
            _set_eighth(groups[1][1], ns)
            rest = _make_note(
                ns, step=None, octave=None, duration=1, note_type="eighth", voice="1", staff="1", rest=True
            )
            _insert_after(measure, groups[2][1][-1], [rest])
            applied += 1
    # 레이아웃 B — voice2: ♩. 𝄽(8분) (서버 산출물 omr-work-0de3cdf2 등)
    g2 = _groups(measure, ns, "1", "2")
    if len(g2) == 2:
        sig2 = _sig(g2, ns)
        rest_dur = sig2[1][1] if len(sig2) > 1 else None
        if (
            sig2[0][0] == frozenset(["A4", "A5"])
            and sig2[0][2] is True
            and sig2[1][0] == frozenset(["REST"])
            and rest_dur is not None
            and sig2[1][2] is False
        ):
            rest_leader = g2[1][0]
            idx = list(measure).index(rest_leader)
            measure.remove(rest_leader)
            notes = [
                _make_note(
                    ns,
                    step="B",
                    octave="4",
                    duration=rest_dur,
                    note_type="eighth",
                    voice="2",
                    staff="1",
                    stem="down",
                ),
                _make_note(
                    ns,
                    step="A",
                    octave="5",
                    duration=rest_dur,
                    note_type="eighth",
                    voice="2",
                    staff="1",
                    stem="down",
                    chord=True,
                ),
            ]
            for i, n in enumerate(notes):
                measure.insert(idx + i, n)
            applied += 1
    return applied


# ---------------------------------------------------------------------------
# 패치 2b — 피아노 오른손 인쇄 27마디: 첫 화음(♩.)만 남고 뒤 "♪ ♩ ♩" 화음이
# 통째로 유실됨 (MXL m26 staff1 voice1, 6/16).
# ---------------------------------------------------------------------------
def _patch_piano_m26(measure: ET.Element, ns: str) -> int:
    if measure.get("number") != "26":
        return 0
    groups = _groups(measure, ns, "1", "1")
    if len(groups) != 1:
        return 0
    if _sig(groups, ns)[0] != (frozenset(["D5", "D6"]), 6, True):
        return 0
    new_notes = [
        _make_note(ns, step="C", octave="5", alter=1, accidental="sharp",
                   duration=2, note_type="eighth", voice="1", staff="1", stem="down"),
        _make_note(ns, step="C", octave="6", alter=1, accidental="sharp",
                   duration=2, note_type="eighth", voice="1", staff="1", stem="down", chord=True),
        _make_note(ns, step="D", octave="5", duration=4, note_type="quarter",
                   voice="1", staff="1", stem="down"),
        _make_note(ns, step="D", octave="6", duration=4, note_type="quarter",
                   voice="1", staff="1", stem="down", chord=True),
        _make_note(ns, step="B", octave="4", duration=4, note_type="quarter",
                   voice="1", staff="1", stem="down"),
        _make_note(ns, step="B", octave="5", duration=4, note_type="quarter",
                   voice="1", staff="1", stem="down", chord=True),
    ]
    _insert_after(measure, groups[0][1][-1], new_notes)
    # staff1 길이가 6→16으로 늘었으므로 staff2로 넘어가는 backup도 16으로 보정
    for el in measure:
        if _local(el) == "backup":
            d = el.find(_qname(ns, "duration"))
            if d is not None and d.text and d.text.strip() == "6":
                d.text = "16"
            break
    return 1


# ---------------------------------------------------------------------------
# 패치 3 — 피아노 오른손 인쇄 45마디: 첫 두 8분 화음이 4분으로 읽히고
# 여섯번째 화음(B4+B5 4분)이 유실됨 (MXL m44 staff1 voice1).
# ---------------------------------------------------------------------------
def _patch_piano_m44_rh(measure: ET.Element, ns: str) -> int:
    if measure.get("number") != "44":
        return 0
    groups = _groups(measure, ns, "1", "1")
    if len(groups) != 5:
        return 0
    sig = _sig(groups, ns)
    expected = [
        (frozenset(["A4", "A5"]), 12, False),
        (frozenset(["F#4", "F#5"]), 12, False),
        (frozenset(["G4", "G5"]), 6, False),
        (frozenset(["A4", "A5"]), 6, False),
        (frozenset(["B4", "B5"]), 12, False),
    ]
    if sig != expected:
        return 0
    _set_eighth(groups[0][1], ns)
    _set_eighth(groups[1][1], ns)
    clones = []
    for n in groups[4][1]:
        c = copy.deepcopy(n)
        for tag in ("notations", "beam", "tie", "lyric"):
            for el in c.findall(_qname(ns, tag)):
                c.remove(el)
        clones.append(c)
    _insert_after(measure, groups[4][1][-1], clones)
    return 1


# ---------------------------------------------------------------------------
# 패치 4 — 피아노 왼손 인쇄 45마디: "♪♪ + 셋잇단×3" 중 첫 두 8분이 4분으로,
# 마지막 두 셋잇단이 8분 3개로 붕괴·1셋잇단 유실 (MXL m44 staff2 voice5).
# ---------------------------------------------------------------------------
def _patch_piano_m44_lh(measure: ET.Element, ns: str) -> int:
    if measure.get("number") != "44":
        return 0
    groups = _groups(measure, ns, "2", "5")
    if len(groups) != 8:
        return 0
    sig = _sig(groups, ns)
    dgb = frozenset(["D3", "G3", "B3"])
    expected = [
        (frozenset(["B1", "B2"]), 12, False),
        (dgb, 12, False),
        (dgb, 4, False),
        (dgb, 4, False),
        (dgb, 4, False),
        (dgb, 6, False),
        (dgb, 6, False),
        (dgb, 6, False),
    ]
    ok = True
    for (pitches, dur, dotted), (exp_pitches, exp_dur, exp_dotted) in zip(sig, expected):
        # 마지막 8분 묶음 첫 화음에 잘못 붙은 B2 등 잉여 음은 허용 (상위집합 비교)
        if not (pitches >= exp_pitches and dur == exp_dur and dotted == exp_dotted):
            ok = False
            break
    if not ok:
        return 0
    _set_eighth(groups[0][1], ns)
    _set_eighth(groups[1][1], ns)
    # 마지막 8분 3개 → 셋잇단(duration 4 + time-modification)으로
    for gi in (5, 6, 7):
        for n in groups[gi][1]:
            d = n.find(_qname(ns, "duration"))
            d.text = "4"
            tm = ET.Element(_qname(ns, "time-modification"))
            ET.SubElement(tm, _qname(ns, "actual-notes")).text = "3"
            ET.SubElement(tm, _qname(ns, "normal-notes")).text = "2"
            dur_idx = list(n).index(d)
            n.insert(dur_idx + 1, tm)

    def _add_tuplet(leader: ET.Element, tuplet_type: str) -> None:
        notations = leader.find(_qname(ns, "notations"))
        if notations is None:
            notations = ET.SubElement(leader, _qname(ns, "notations"))
        attrib = {"type": tuplet_type}
        if tuplet_type == "start":
            attrib["show-number"] = "actual"
        ET.SubElement(notations, _qname(ns, "tuplet"), attrib=attrib)

    _add_tuplet(groups[5][0], "start")
    _add_tuplet(groups[7][0], "stop")
    # 유실된 세번째 셋잇단: 위 셋잇단을 복제해 뒤에 붙임
    clones: list[ET.Element] = []
    for gi in (5, 6, 7):
        for n in groups[gi][1]:
            clones.append(copy.deepcopy(n))
    _insert_after(measure, groups[7][1][-1], clones)
    return 1


# ---------------------------------------------------------------------------
# 패치 5 — 피아노 오른손 인쇄 57마디: 잘못된 성부 분리로 4·5번째 음이 겹쳐 들림.
# 진실: C5♩. B4♪ A4♪(페르마타) (E4,E5)♪ (A4,A5)♪ (B4,B5)♪ (MXL m56 staff1).
# ---------------------------------------------------------------------------
def _patch_piano_m56(measure: ET.Element, ns: str) -> int:
    if measure.get("number") != "56":
        return 0
    v1 = _groups(measure, ns, "1", "1")
    v2 = _groups(measure, ns, "1", "2")
    if len(v1) != 4 or len(v2) != 2:
        return 0
    sig1 = _sig(v1, ns)
    sig2 = _sig(v2, ns)
    if not (
        sig1[0] == (frozenset(["C5"]), 3, True)
        and sig1[1] == (frozenset(["B4"]), 2, False)
        and sig1[2] == (frozenset(["A4", "A5"]), 1, False)
        and sig1[3] == (frozenset(["B4", "B5"]), 1, False)
        and sig2[0] == (frozenset(["A4"]), 1, False)
        and sig2[1] == (frozenset(["E4", "E5"]), 1, False)
    ):
        return 0
    _set_eighth(v1[1][1], ns)  # B4 ♩→♪
    children = list(measure)
    v2_notes = [n for g in v2 for n in g[1]]
    v2_first_idx = children.index(v2_notes[0])
    # voice 2 음표 직전의 backup/forward 제거 (성부 겹침의 원인)
    to_remove = []
    for el in children[:v2_first_idx][::-1]:
        if _local(el) in ("backup", "forward"):
            to_remove.append(el)
        elif _local(el) == "note":
            break
    for el in to_remove:
        measure.remove(el)
    for n in v2_notes:
        measure.remove(n)
        voice_el = n.find(_qname(ns, "voice"))
        if voice_el is not None:
            voice_el.text = "1"
    # B4(2번째 그룹) 뒤에 A4, E4+E5 순으로 삽입
    _insert_after(measure, v1[1][1][-1], v2_notes)
    # staff2로 넘어가는 backup 길이를 마디 길이(8)로 보정
    for el in measure:
        if _local(el) == "backup":
            d = el.find(_qname(ns, "duration"))
            if d is not None and d.text and d.text.strip() in ("6", "7"):
                d.text = "8"
            break
    return 1


# ---------------------------------------------------------------------------
# 패치 6 — 인쇄 58마디 온음표 화음: PR에 C6, PL에 C4가 유실됨 (MXL m57).
# ---------------------------------------------------------------------------
def _patch_piano_m57(measure: ET.Element, ns: str) -> int:
    if measure.get("number") != "57":
        return 0
    applied = 0
    rh = _groups(measure, ns, "1", "1")
    if len(rh) == 1 and _sig(rh, ns)[0][0] == frozenset(["C5"]):
        leader = rh[0][0]
        dur = _duration(leader, ns) or 8
        c6 = _make_note(
            ns, step="C", octave="6", duration=dur, note_type="whole", voice="1", staff="1", chord=True
        )
        _insert_after(measure, rh[0][1][-1], [c6])
        applied += 1
    lh = _groups(measure, ns, "2", "5")
    if len(lh) == 1 and _sig(lh, ns)[0][0] == frozenset(["D#3", "F#3", "A3"]):
        leader = lh[0][0]
        dur = _duration(leader, ns) or 8
        c4 = _make_note(
            ns, step="C", octave="4", duration=dur, note_type="whole", voice="5", staff="2", chord=True
        )
        _insert_after(measure, lh[0][1][-1], [c4])
        applied += 1
    return applied


_PATCHES = [
    _patch_vocal_pickup,
    _patch_piano_m18,
    _patch_piano_m26,
    _patch_piano_m44_rh,
    _patch_piano_m44_lh,
    _patch_piano_m56,
    _patch_piano_m57,
]


def apply_score_patches(root: ET.Element, ns: str) -> int:
    applied = 0
    for part in root.findall(_qname(ns, "part")):
        for measure in part.findall(_qname(ns, "measure")):
            for patch in _PATCHES:
                try:
                    applied += patch(measure, ns)
                except Exception:
                    # 패치는 보수적으로 — 실패해도 변환은 계속.
                    continue
    return applied
