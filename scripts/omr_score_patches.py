#!/usr/bin/env python3
"""악보별(콘텐츠 시그니처 기반) Audiveris MXL 패턴 패치 — **최후 수단**.

범용 보정(`fix_audiveris_mxl.py`)으로 처리할 수 없는 경우만 둔다.
- **음표 발명**: OMR이 아예 검출하지 못한 음·화음 구성음을 PDF 근거로 삽입
- **성부 재배치**: voice 분리·backup 순서가 악보 구조와 어긋난 경우

마디 번호가 아니라 **pitch·duration·voice 시그니처**가 일치할 때만 동작한다.
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
# ♩. ♪ ♩ ♪ — 마지막 8분이 특정 pitch로 복원되어야 하는 경우(범용 복원은 g2 클론).
# (앞 3음 pitch 시퀀스, 복원 (step, octave))
# ---------------------------------------------------------------------------
_PICKUP_RESTORES = [
    (["A4", "B4", "C5"], ("D", "5")),
    (["C5", "B4", "A4"], ("D", "5")),
    (["A3", "B3", "C4"], ("D", "4")),
]


def _measure_expected_duration(measure: ET.Element, ns: str, part: ET.Element) -> int | None:
    divisions = beats = beat_type = None
    for m in part.findall(_qname(ns, "measure")):
        for attr in m.findall(_qname(ns, "attributes")):
            d = attr.find(_qname(ns, "divisions"))
            if d is not None and d.text and d.text.strip().isdigit():
                divisions = int(d.text.strip())
            t = attr.find(_qname(ns, "time"))
            if t is not None:
                b = t.find(_qname(ns, "beats"))
                bt = t.find(_qname(ns, "beat-type"))
                if b is not None and b.text and bt is not None and bt.text:
                    beats, beat_type = int(b.text), int(bt.text)
        if m is measure:
            break
    if divisions and beats and beat_type:
        return divisions * beats * 4 // beat_type
    return None


def _patch_vocal_pickup(measure: ET.Element, ns: str, part: ET.Element) -> int:
    applied = 0
    expected = _measure_expected_duration(measure, ns, part)
    if not expected:
        return 0
    for seq, restore in _PICKUP_RESTORES:
        groups = _groups(measure, ns, "1", "1")
        if len(groups) != 4:
            continue
        sig = _sig(groups, ns)
        eighth_dur = _duration(groups[1][0], ns) or 1
        if eighth_dur > 3:
            eighth_dur = eighth_dur // 2
        if not (
            sig[0][2] is True
            and sig[1][2] is False
            and sig[2][2] is False
            and sig[3][0] == frozenset(["REST"])
            and frozenset([seq[0]]) <= sig[0][0]
            and frozenset([seq[1]]) <= sig[1][0]
            and frozenset([seq[2]]) <= sig[2][0]
        ):
            continue
        total = sum(_duration(g[0], ns) or 0 for g in groups)
        if total != expected + eighth_dur:
            continue
        _set_eighth(groups[1][1], ns)
        if restore is not None:
            step, octave = restore
            rest_leader = groups[3][0]
            staff = _text(rest_leader.find(_qname(ns, "staff")))
            new_note = _make_note(
                ns,
                step=step,
                octave=octave,
                duration=eighth_dur,
                note_type="eighth",
                voice="1",
                staff=staff,
                stem="down",
            )
            _insert_after(measure, rest_leader, [new_note])
        applied += 1
    return applied


# ---------------------------------------------------------------------------
# ♩. 뒤 "♪ ♩ ♩" 화음 통째 유실 — OMR 미검출 음표 삽입
# ---------------------------------------------------------------------------
def _patch_piano_lost_rhythm_after_dotted(measure: ET.Element, ns: str) -> int:
    groups = _groups(measure, ns, "1", "1")
    if len(groups) != 1:
        return 0
    if _sig(groups, ns)[0] != (frozenset(["D5", "D6"]), 6, True):
        return 0
    new_notes = [
        _make_note(
            ns,
            step="C",
            octave="5",
            alter=1,
            accidental="sharp",
            duration=2,
            note_type="eighth",
            voice="1",
            staff="1",
            stem="down",
        ),
        _make_note(
            ns,
            step="C",
            octave="6",
            alter=1,
            accidental="sharp",
            duration=2,
            note_type="eighth",
            voice="1",
            staff="1",
            stem="down",
            chord=True,
        ),
        _make_note(
            ns,
            step="D",
            octave="5",
            duration=4,
            note_type="quarter",
            voice="1",
            staff="1",
            stem="down",
        ),
        _make_note(
            ns,
            step="D",
            octave="6",
            duration=4,
            note_type="quarter",
            voice="1",
            staff="1",
            stem="down",
            chord=True,
        ),
        _make_note(
            ns,
            step="B",
            octave="4",
            duration=4,
            note_type="quarter",
            voice="1",
            staff="1",
            stem="down",
        ),
        _make_note(
            ns,
            step="B",
            octave="5",
            duration=4,
            note_type="quarter",
            voice="1",
            staff="1",
            stem="down",
            chord=True,
        ),
    ]
    _insert_after(measure, groups[0][1][-1], new_notes)
    for el in measure:
        if _local(el) == "backup":
            d = el.find(_qname(ns, "duration"))
            if d is not None and d.text and d.text.strip() == "6":
                d.text = "16"
            break
    return 1


# ---------------------------------------------------------------------------
# 4분 2개+8분 run 뒤 유실된 마지막 4분 화음 복제 삽입
# ---------------------------------------------------------------------------
def _patch_piano_lost_quarter_after_eighth_run(measure: ET.Element, ns: str) -> int:
    groups = _groups(measure, ns, "1", "1")
    if len(groups) != 5:
        return 0
    sig = _sig(groups, ns)
    a_oct = frozenset(["A4", "A5"])
    fs_oct = frozenset(["F#4", "F#5"])
    g_oct = frozenset(["G4", "G5"])
    b_oct = frozenset(["B4", "B5"])
    # 범용 4분→8분 보정 후: 앞 2그룹이 8분(6)이어도 동일
    expected_quarters = [
        (a_oct, 12, False),
        (fs_oct, 12, False),
        (g_oct, 6, False),
        (a_oct, 6, False),
        (b_oct, 12, False),
    ]
    expected_eighths = [
        (a_oct, 6, False),
        (fs_oct, 6, False),
        (g_oct, 6, False),
        (a_oct, 6, False),
        (b_oct, 12, False),
    ]
    if sig not in (expected_quarters, expected_eighths):
        return 0
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
# voice2에 겹쳐 들어간 짧은 음을 voice1 타임라인에 재삽입
# ---------------------------------------------------------------------------
def _patch_piano_voice_split_overlap(measure: ET.Element, ns: str) -> int:
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
    _set_eighth(v1[1][1], ns)
    children = list(measure)
    v2_notes = [n for g in v2 for n in g[1]]
    v2_first_idx = children.index(v2_notes[0])
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
    _insert_after(measure, v1[1][1][-1], v2_notes)
    for el in measure:
        if _local(el) == "backup":
            d = el.find(_qname(ns, "duration"))
            if d is not None and d.text and d.text.strip() in ("6", "7"):
                d.text = "8"
            break
    return 1


# ---------------------------------------------------------------------------
# 온음표 화음에서 옥타브 구성음 유실
# ---------------------------------------------------------------------------
def _patch_piano_lost_whole_chord_tone(measure: ET.Element, ns: str) -> int:
    applied = 0
    rh = _groups(measure, ns, "1", "1")
    if len(rh) == 1 and _sig(rh, ns)[0][0] == frozenset(["C5"]):
        leader = rh[0][0]
        dur = _duration(leader, ns) or 8
        c6 = _make_note(
            ns,
            step="C",
            octave="6",
            duration=dur,
            note_type="whole",
            voice="1",
            staff="1",
            chord=True,
        )
        _insert_after(measure, rh[0][1][-1], [c6])
        applied += 1
    lh = _groups(measure, ns, "2", "5")
    if len(lh) == 1 and _sig(lh, ns)[0][0] == frozenset(["D#3", "F#3", "A3"]):
        leader = lh[0][0]
        dur = _duration(leader, ns) or 8
        c4 = _make_note(
            ns,
            step="C",
            octave="4",
            duration=dur,
            note_type="whole",
            voice="5",
            staff="2",
            chord=True,
        )
        _insert_after(measure, lh[0][1][-1], [c4])
        applied += 1
    return applied


# ---------------------------------------------------------------------------
# ♩. ♪ ♩. (16분박) — 가운데 8분이 4분으로, 끝 8분쉼표 유실
# ---------------------------------------------------------------------------
def _patch_sixteenth_dotted_pickup(measure: ET.Element, ns: str) -> int:
    groups = _groups(measure, ns, "1", "1")
    if len(groups) != 3:
        return 0
    sig = _sig(groups, ns)
    if (
        sig[0] == (frozenset(["C5", "B5"]), 3, True)
        and sig[1] == (frozenset(["B4", "A5"]), 2, False)
        and sig[2] == (frozenset(["A4", "A5"]), 3, True)
    ):
        _set_eighth(groups[1][1], ns)
        rest = _make_note(
            ns,
            step=None,
            octave=None,
            duration=1,
            note_type="eighth",
            voice="1",
            staff="1",
            rest=True,
        )
        _insert_after(measure, groups[2][1][-1], [rest])
        return 1
    return 0


_PATCHES = [
    _patch_vocal_pickup,
    _patch_sixteenth_dotted_pickup,
    _patch_piano_lost_rhythm_after_dotted,
    _patch_piano_lost_quarter_after_eighth_run,
    _patch_piano_lost_whole_chord_tone,
]


def apply_score_patches(root: ET.Element, ns: str) -> int:
    applied = 0
    for part in root.findall(_qname(ns, "part")):
        for measure in part.findall(_qname(ns, "measure")):
            for patch in _PATCHES:
                try:
                    if patch is _patch_vocal_pickup:
                        applied += patch(measure, ns, part)
                    else:
                        applied += patch(measure, ns)
                except TypeError:
                    applied += patch(measure, ns)
                except Exception:
                    continue
    return applied
