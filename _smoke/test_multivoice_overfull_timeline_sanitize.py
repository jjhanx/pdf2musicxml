#!/usr/bin/env python3
"""다성부 마디 성부 타임라인 초과(overfull) 정규화 검증.

한 파트에 두 voice가 있을 때, OMR 오인 등으로 forward나 음표 duration이 마디 길이를
초과하여 다른 성부 음표가 밀리고 마디 끝에 유령 쉼표가 생기는 문제를 해결했는지 확인.
"""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import (
    _measure_divisions_beats,
    _measure_length_units,
    _local,
    _note_duration,
    _note_voice_staff,
    _ns,
    _q,
    load_mxl_root,
    sanitize_measure_voice_timelines,
    sanitize_measure_voice_timelines_in_root,
)


def _check_measure_overfull_voices(measure: ET.Element, ns: str, part: ET.Element | None = None) -> list[tuple[str, int, int]]:
    divisions, beats, beat_type = _measure_divisions_beats(measure, ns, part)
    measure_len = _measure_length_units(divisions, beats, beat_type)
    if measure_len <= 0:
        return []

    last_voice = "1"
    voice_fwd: dict[str, int] = {}
    voice_notes: dict[str, int] = {}
    for el in measure:
        tag = _local(el)
        if tag == "forward":
            dur = int((el.findtext(_q(ns, "duration")) or "0").strip() or 0)
            v = el.findtext(_q(ns, "voice")) or last_voice
            voice_fwd[v] = voice_fwd.get(v, 0) + dur
        elif tag == "note":
            if el.find(_q(ns, "chord")) is not None:
                continue
            v, _st = _note_voice_staff(el, ns)
            last_voice = v
            voice_notes[v] = voice_notes.get(v, 0) + _note_duration(el, ns)

    overfull: list[tuple[str, int, int]] = []
    for v, ndur in voice_notes.items():
        tot = voice_fwd.get(v, 0) + ndur
        if tot > measure_len:
            overfull.append((v, tot, measure_len))
    return overfull


def test_real_score_measures() -> None:
    score_path = ROOT / "바람이 불어오는 곳 2026" / "바람이 불어오는 곳 2026.mxl"
    if not score_path.exists():
        print("Score not found, skipping real score test")
        return

    _files, _root_path, root = load_mxl_root(score_path)
    ns = _ns(root)
    p5 = root.find('.//{*}part[@id="P5"]')
    assert p5 is not None, "Part P5 not found"

    # Before sanitize, measures 14, 19, 20, 21 had overfull voices
    m14 = p5.find('.//{*}measure[@number="14"]')
    m19 = p5.find('.//{*}measure[@number="19"]')
    m20 = p5.find('.//{*}measure[@number="20"]')
    m21 = p5.find('.//{*}measure[@number="21"]')

    assert m14 is not None and m19 is not None and m20 is not None and m21 is not None

    assert len(_check_measure_overfull_voices(m14, ns, p5)) > 0, "m14 should have overfull voice before fix"
    assert len(_check_measure_overfull_voices(m19, ns, p5)) > 0, "m19 should have overfull voice before fix"
    assert len(_check_measure_overfull_voices(m20, ns, p5)) > 0, "m20 should have overfull voice before fix"
    assert len(_check_measure_overfull_voices(m21, ns, p5)) > 0, "m21 should have overfull voice before fix"

    # Apply sanitize
    n = sanitize_measure_voice_timelines_in_root(root)
    assert n >= 4, f"Expected at least 4 measures sanitized, got {n}"

    # After sanitize, none of the measures should have overfull voices
    for mnum in ["14", "19", "20", "21"]:
        m = p5.find(f'.//{{*}}measure[@number="{mnum}"]')
        assert m is not None
        ov = _check_measure_overfull_voices(m, ns, p5)
        assert len(ov) == 0, f"Measure {mnum} still has overfull voice after sanitize: {ov}"

    print("test_real_score_measures passed!")


def test_synthetic_overfull_cases() -> None:
    ns = "http://www.musicxml.org/ns/partwise"
    # Case 1: voice 2 has two half notes (24+24=48 in 4/4 div=12) with forward=24
    xml = f"""<measure number="1" xmlns="{ns}">
      <attributes>
        <divisions>12</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>48</duration><voice>1</voice></note>
      <backup><duration>48</duration></backup>
      <forward><duration>24</duration><voice>2</voice></forward>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>24</duration><voice>2</voice></note>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>24</duration><voice>2</voice></note>
    </measure>"""
    m = ET.fromstring(xml)
    assert len(_check_measure_overfull_voices(m, ns)) == 1

    ch = sanitize_measure_voice_timelines(m, ns)
    assert ch is True
    assert len(_check_measure_overfull_voices(m, ns)) == 0

    # Ensure forward is removed and both half notes remain
    assert m.find(f"{{{ns}}}forward") is None
    notes_v2 = [n for n in m.findall(f"{{{ns}}}note") if n.findtext(f"{{{ns}}}voice") == "2"]
    assert len(notes_v2) == 2
    assert notes_v2[0].findtext(f"{{{ns}}}duration") == "24"
    assert notes_v2[1].findtext(f"{{{ns}}}duration") == "24"

    # Case 2: voice 2 has note at 42 with duration 9 (measure_len=48)
    xml2 = f"""<measure number="2" xmlns="{ns}">
      <attributes>
        <divisions>12</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>48</duration><voice>1</voice></note>
      <backup><duration>48</duration></backup>
      <forward><duration>42</duration><voice>2</voice></forward>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>9</duration>
        <voice>2</voice>
        <type>eighth</type>
        <dot/>
      </note>
    </measure>"""
    m2 = ET.fromstring(xml2)
    assert len(_check_measure_overfull_voices(m2, ns)) == 1

    ch2 = sanitize_measure_voice_timelines(m2, ns)
    assert ch2 is True
    assert len(_check_measure_overfull_voices(m2, ns)) == 0

    # The forward should be adjusted to 39 or note clamped to 6
    v2_notes = [n for n in m2.findall(f"{{{ns}}}note") if n.findtext(f"{{{ns}}}voice") == "2"]
    assert len(v2_notes) == 1
    fwd = m2.find(f"{{{ns}}}forward")
    fwd_dur = int(fwd.findtext(f"{{{ns}}}duration") or "0") if fwd is not None else 0
    note_dur = int(v2_notes[0].findtext(f"{{{ns}}}duration") or "0")
    assert fwd_dur + note_dur == 48

    print("test_synthetic_overfull_cases passed!")


if __name__ == "__main__":
    test_real_score_measures()
    test_synthetic_overfull_cases()
    print("All multivoice overfull sanitize tests passed!")
