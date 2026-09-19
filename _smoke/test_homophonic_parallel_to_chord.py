"""Audiveris same-x parallel voices → one-voice chords (m13 PR).

Run: python _smoke/test_homophonic_parallel_to_chord.py
"""
from __future__ import annotations

import io
import sys
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import (  # noqa: E402
    _ns,
    _note_duration,
    _note_pitch_key,
    _note_voice_staff,
    list_note_elements,
    merge_homophonic_parallel_voices_in_measure,
    rebuild_measure_timeline_clean,
)


def _local(el: ET.Element) -> str:
    return el.tag.split("}")[-1] if "}" in el.tag else el.tag


def _load_measure(zip_name: str, part_id: str, measure_number: str) -> ET.Element:
    zpath = ROOT / zip_name
    if not zpath.is_file():
        raise SystemExit(f"skip: missing {zip_name}")
    with zipfile.ZipFile(zpath) as z:
        raw = z.read("audiveris_pristine.mxl")
    with zipfile.ZipFile(io.BytesIO(raw)) as inner:
        xml_name = next(
            n
            for n in inner.namelist()
            if n.endswith(".xml") and "META" not in n.upper()
        )
        root = ET.fromstring(inner.read(xml_name))
    ns = _ns(root)
    q = f"{{{ns}}}" if ns else ""
    for part in root.findall(f"{q}part"):
        if part.get("id") != part_id:
            continue
        for m in part.findall(f"{q}measure"):
            if m.get("number") == measure_number:
                return m
    raise SystemExit(f"measure {measure_number} part {part_id} not found")


def _pitch_label(note: ET.Element, ns: str) -> str:
    key = _note_pitch_key(note, ns)
    if key is None:
        return "?"
    step, octv, alter = key
    acc = "#" if alter == 1 else "b" if alter == -1 else ""
    return f"{step}{acc}{octv}"


def _staff1_summary(measure: ET.Element, ns: str) -> list[tuple[str, str, bool]]:
    out: list[tuple[str, str, bool]] = []
    for note in list_note_elements(measure, ns):
        v, st = _note_voice_staff(note, ns)
        if st != "1":
            continue
        if note.find(f"{{{ns}}}rest" if ns else "rest") is not None:
            continue
        chord = note.find(f"{{{ns}}}chord" if ns else "chord") is not None
        out.append((_pitch_label(note, ns), v, chord))
    return out


def test_m13_pr_merges_to_chords() -> None:
    m = _load_measure("omr-work-c181066c.zip", "P5", "13")
    ns = _ns(m)
    before = _staff1_summary(m, ns)
    voices_before = {v for _p, v, _c in before}
    assert voices_before == {"1", "2"}, f"expected Audiveris split, got {voices_before}"

    assert merge_homophonic_parallel_voices_in_measure(m, ns)
    after = _staff1_summary(m, ns)
    voices_after = {v for _p, v, _c in after}
    assert voices_after == {"1"}, f"expected single voice, got {voices_after}: {after}"

    # First onset: A4 + F4 chord
    leaders = [t for t in after if not t[2]]
    members = [t for t in after if t[2]]
    assert any(p == "A4" and not c for p, _v, c in after)
    assert any(p == "F4" and c for p, _v, c in after)
    assert len(members) >= 6, f"expected several chord members, got {after}"
    assert len(leaders) == 8, f"expected 8 rhythmic leaders, got {leaders}"


def test_m13_survives_rebuild() -> None:
    """HITL rebuild must NOT chord-merge — intentional multi-voice kept."""
    m = _load_measure("omr-work-c181066c.zip", "P5", "13")
    ns = _ns(m)
    rebuild_measure_timeline_clean(m, ns, None)
    after = _staff1_summary(m, ns)
    voices = {v for _p, v, _c in after}
    assert voices == {"1", "2"}, f"rebuild must keep PR voices, got {voices}: {after}"


def test_m13_explicit_merge_still_chords() -> None:
    """OMR 정리 경로(명시 merge)는 여전히 화음으로 합침."""
    m = _load_measure("omr-work-c181066c.zip", "P5", "13")
    ns = _ns(m)
    assert merge_homophonic_parallel_voices_in_measure(m, ns)
    after = _staff1_summary(m, ns)
    voices = {v for _p, v, _c in after}
    assert voices == {"1"}, f"explicit merge must chordify PR, got {voices}: {after}"
    assert any(c for _p, _v, c in after)


def test_m13_pl_half_bass_not_merged() -> None:
    """PL v5 quarter + v6 half(same x) — 의도적 다성, chord merge 금지."""
    m = _load_measure("omr-work-c181066c.zip", "P5", "13")
    ns = _ns(m)
    # Only PL staff merge check: run pairs logic via full measure merge
    # PR may still merge; ensure PL v6 half survives.
    merge_homophonic_parallel_voices_in_measure(m, ns)
    pl = [
        n
        for n in list_note_elements(m, ns)
        if _note_voice_staff(n, ns)[1] == "2"
    ]
    voices = {_note_voice_staff(n, ns)[0] for n in pl}
    assert "6" in voices, f"v6 half bass must remain, got {voices}"
    f2 = next(n for n in pl if _note_pitch_key(n, ns) == ("F", 2, 0))
    assert f2.find(f"{{{ns}}}chord" if ns else "chord") is None
    assert _note_duration(f2, ns) == 24
    assert _note_voice_staff(f2, ns)[0] == "6"


def test_synthetic_half_under_quarter_not_merged() -> None:
    """HITL로 v6에 2분 추가한 경우 — 4분과 박자 다르면 화음으로 합치지 않음."""
    ns = ""
    m = ET.Element("measure", number="1")

    def note(step: str, octv: str, voice: str, dx: str, dur: str, typ: str) -> None:
        n = ET.SubElement(m, "note")
        n.set("default-x", dx)
        p = ET.SubElement(n, "pitch")
        ET.SubElement(p, "step").text = step
        ET.SubElement(p, "octave").text = octv
        ET.SubElement(n, "duration").text = dur
        ET.SubElement(n, "voice").text = voice
        ET.SubElement(n, "type").text = typ
        ET.SubElement(n, "stem").text = "up" if voice == "5" else "down"
        ET.SubElement(n, "staff").text = "2"

    note("F", "3", "5", "32.00", "12", "quarter")
    note("F", "3", "5", "132.00", "12", "quarter")
    b = ET.SubElement(m, "backup")
    ET.SubElement(b, "duration").text = "24"
    note("F", "2", "6", "32.00", "24", "half")

    assert not merge_homophonic_parallel_voices_in_measure(m, ns)
    voices = {
        n.find("voice").text
        for n in m.findall("note")
        if n.find("staff") is not None and n.find("staff").text == "2"
    }
    assert voices == {"5", "6"}


def test_synthetic_underfull_same_duration_merges() -> None:
    """앞에만 같은 박·같은 x인 짧은 층은 화음으로 흡수."""
    ns = ""
    m = ET.Element("measure", number="1")

    def note(step: str, octv: str, voice: str, dx: str, dur: str, typ: str) -> None:
        n = ET.SubElement(m, "note")
        n.set("default-x", dx)
        p = ET.SubElement(n, "pitch")
        ET.SubElement(p, "step").text = step
        ET.SubElement(p, "octave").text = octv
        ET.SubElement(n, "duration").text = dur
        ET.SubElement(n, "voice").text = voice
        ET.SubElement(n, "type").text = typ
        ET.SubElement(n, "stem").text = "up" if voice == "5" else "down"
        ET.SubElement(n, "staff").text = "2"

    note("F", "3", "5", "32.00", "12", "quarter")
    note("F", "3", "5", "132.00", "12", "quarter")
    b = ET.SubElement(m, "backup")
    ET.SubElement(b, "duration").text = "24"
    note("F", "2", "6", "32.00", "12", "quarter")

    assert merge_homophonic_parallel_voices_in_measure(m, ns)
    voices = {
        n.find("voice").text
        for n in m.findall("note")
        if n.find("staff") is not None and n.find("staff").text == "2"
    }
    assert voices == {"5"}
    f2 = next(n for n in m.findall("note") if n.find("pitch/octave").text == "2")
    assert f2.find("chord") is not None


def test_m16_different_x_not_merged() -> None:
    """Natural polyphony (different default-x) must stay multi-voice."""
    zpath = ROOT / "omr-work-0ea5ea52.zip"
    if not zpath.is_file():
        print("skip m16 guard (no zip)")
        return
    m = _load_measure("omr-work-0ea5ea52.zip", "P5", "16")
    ns = _ns(m)
    before_voices = {
        _note_voice_staff(n, ns)[0]
        for n in list_note_elements(m, ns)
        if _note_voice_staff(n, ns)[1] == "1"
    }
    if len(before_voices) < 2:
        print("skip m16: already single voice")
        return
    changed = merge_homophonic_parallel_voices_in_measure(m, ns)
    after_voices = {
        _note_voice_staff(n, ns)[0]
        for n in list_note_elements(m, ns)
        if _note_voice_staff(n, ns)[1] == "1"
    }
    assert not changed, "m16 different-x voices must not chord-merge"
    assert after_voices == before_voices


def test_synthetic_same_x_chord() -> None:
    ns = ""
    m = ET.Element("measure", number="1")
    def note(step: str, octv: str, voice: str, dx: str, *, chord: bool = False) -> ET.Element:
        n = ET.SubElement(m, "note")
        n.set("default-x", dx)
        if chord:
            ET.SubElement(n, "chord")
        p = ET.SubElement(n, "pitch")
        ET.SubElement(p, "step").text = step
        ET.SubElement(p, "octave").text = octv
        ET.SubElement(n, "duration").text = "6"
        ET.SubElement(n, "voice").text = voice
        ET.SubElement(n, "type").text = "eighth"
        ET.SubElement(n, "stem").text = "up" if voice == "1" else "down"
        ET.SubElement(n, "staff").text = "1"
        return n

    note("A", "4", "1", "32.00")
    note("F", "4", "1", "80.00")
    b = ET.SubElement(m, "backup")
    ET.SubElement(b, "duration").text = "12"
    note("F", "4", "2", "32.00")
    note("C", "4", "2", "80.00")

    assert merge_homophonic_parallel_voices_in_measure(m, ns)
    summary = _staff1_summary(m, ns)
    assert {v for _p, v, _c in summary} == {"1"}
    pitches = sorted(p for p, _v, _c in summary)
    assert pitches == ["A4", "C4", "F4", "F4"], pitches
    assert sum(1 for _p, _v, c in summary if c) == 2


if __name__ == "__main__":
    test_synthetic_same_x_chord()
    test_synthetic_half_under_quarter_not_merged()
    test_synthetic_underfull_same_duration_merges()
    test_m13_pr_merges_to_chords()
    test_m13_survives_rebuild()
    test_m13_explicit_merge_still_chords()
    test_m13_pl_half_bass_not_merged()
    test_m16_different_x_not_merged()
    print("ok")
