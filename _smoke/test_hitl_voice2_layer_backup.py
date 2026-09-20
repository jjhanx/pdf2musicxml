"""HITL: PR staff voice2 insert / setNoteVoice must keep note + voice-layer backup.

증상: omr-work-4acf2013 m14 PR — voice2로 넣거나 voice1→2 바꾸면 OSMD에서 사라짐.
원인: setNoteVoice가 timeline rebuild를 건너뛰어 backup 없이 voice2가 voice1 뒤에 순차 배치됨.
"""
from __future__ import annotations

import io
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.omr_hitl_lib import (  # noqa: E402
    _local,
    _ns,
    _note_voice_staff,
    _q,
    apply_fixes_to_root,
    list_note_elements,
)


def _load_m14():
    z = zipfile.ZipFile(ROOT / "omr-work-4acf2013.zip")
    inner = zipfile.ZipFile(io.BytesIO(z.read("review.mxl")))
    name = next(n for n in inner.namelist() if n.endswith(".xml") and "META" not in n.upper())
    root = ET.parse(io.BytesIO(inner.read(name))).getroot()
    ns = _ns(root)
    part = next(p for p in root.findall(f".//{_q(ns, 'part')}") if p.get("id") == "P5")
    measure = next(
        m for m in part if _local(m) == "measure" and m.get("number") == "14"
    )
    return root, ns, part, measure


def _snap(measure: ET.Element, ns: str) -> str:
    parts: list[str] = []
    for el in list(measure):
        loc = _local(el)
        if loc == "note":
            if el.find(_q(ns, "chord")) is not None:
                continue
            v, st = _note_voice_staff(el, ns)
            pitch = el.find(_q(ns, "pitch"))
            p = "R"
            if pitch is not None:
                p = (pitch.findtext(_q(ns, "step")) or "") + (
                    pitch.findtext(_q(ns, "octave")) or ""
                )
            parts.append(f"v{v}/st{st}:{p}")
        elif loc in ("backup", "forward"):
            parts.append(f"{loc}({el.findtext(_q(ns, 'duration'))})")
    return " | ".join(parts)


def _last_staff1_leader(measure: ET.Element, ns: str) -> int:
    notes = list_note_elements(measure, ns)
    after = -1
    for i, n in enumerate(notes):
        if _note_voice_staff(n, ns)[1] == "1" and n.find(_q(ns, "chord")) is None:
            after = i
    return after


def _assert_voice2_with_backup(measure: ET.Element, ns: str, pitch: str) -> None:
    snap = _snap(measure, ns)
    assert f"v2/st1:{pitch}" in snap, snap
    # voice1 … backup … voice2 … backup … staff2
    assert "backup(" in snap, snap
    v1_end = snap.rfind("v1/st1:")
    v2_pos = snap.find("v2/st1:")
    assert v1_end >= 0 and v2_pos > v1_end, snap
    between = snap[v1_end:v2_pos]
    assert "backup(" in between, f"no voice-layer backup before voice2: {snap}"
    # PR→PL backup still present
    st2 = snap.find("v5/st2:")
    assert st2 > v2_pos, snap
    assert "backup(" in snap[v2_pos:st2], f"no cross-staff backup before PL: {snap}"


def test_insert_voice2_keeps_note_and_backups() -> None:
    root, ns, _part, measure = _load_m14()
    after = _last_staff1_leader(measure, ns)
    stats = apply_fixes_to_root(
        root,
        [
            {
                "kind": "insertNote",
                "partId": "P5",
                "measureMxl": 14,
                "afterNoteIndex": after,
                "staff": 1,
                "pitchStep": "B",
                "pitchOctave": 3,
                "noteType": "quarter",
                "voice": "2",
            }
        ],
    )
    assert stats["applied"] == 1
    v2 = [
        n
        for n in list_note_elements(measure, ns)
        if _note_voice_staff(n, ns) == ("2", "1")
    ]
    assert len(v2) == 1, _snap(measure, ns)
    _assert_voice2_with_backup(measure, ns, "B3")


def test_set_note_voice_rebuilds_layer_backup() -> None:
    root, ns, _part, measure = _load_m14()
    after = _last_staff1_leader(measure, ns)
    apply_fixes_to_root(
        root,
        [
            {
                "kind": "insertNote",
                "partId": "P5",
                "measureMxl": 14,
                "afterNoteIndex": after,
                "staff": 1,
                "pitchStep": "E",
                "pitchOctave": 4,
                "noteType": "quarter",
                "voice": "1",
            }
        ],
    )
    notes = list_note_elements(measure, ns)
    idx = next(
        i
        for i, n in enumerate(notes)
        if (pitch := n.find(_q(ns, "pitch"))) is not None
        and pitch.findtext(_q(ns, "step")) == "E"
        and pitch.findtext(_q(ns, "octave")) == "4"
        and (n.findtext(_q(ns, "type")) or "") == "quarter"
        and n.find(_q(ns, "chord")) is None
    )
    stats = apply_fixes_to_root(
        root,
        [
            {
                "kind": "setNoteVoice",
                "partId": "P5",
                "measureMxl": 14,
                "noteIndex": idx,
                "voice": "2",
                "staff": 1,
            }
        ],
    )
    assert stats["applied"] == 1
    v2 = [
        n
        for n in list_note_elements(measure, ns)
        if _note_voice_staff(n, ns) == ("2", "1")
    ]
    assert len(v2) == 1, _snap(measure, ns)
    _assert_voice2_with_backup(measure, ns, "E4")


if __name__ == "__main__":
    test_insert_voice2_keeps_note_and_backups()
    test_set_note_voice_rebuilds_layer_backup()
    print("ok")
