"""sole→1 must not remap piano PL voice 5→1 (MuseScore phantom whole rests)."""
from __future__ import annotations

import sys
import zipfile
import xml.etree.ElementTree as ET
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from fix_audiveris_mxl import fix_mxl_file  # noqa: E402
from omr_hitl_lib import (  # noqa: E402
    _note_voice_staff,
    list_note_elements,
    normalize_sole_staff_voices_to_one_in_measure,
    normalize_sole_staff_voices_to_one_in_root,
)


def test_unit_skip_grand_staff() -> None:
    m = ET.fromstring(
        """<measure number="1">
  <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
  <backup><duration>4</duration></backup>
  <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
</measure>"""
    )
    assert normalize_sole_staff_voices_to_one_in_measure(m, "") is False
    notes = list_note_elements(m, "")
    assert _note_voice_staff(notes[1], "") == ("5", "2")


def test_unit_satb_still_remaps() -> None:
    m = ET.fromstring(
        """<measure number="60">
  <note><pitch><step>A</step><octave>4</octave></pitch><duration>6</duration><voice>2</voice><type>eighth</type></note>
  <note><pitch><step>A</step><octave>4</octave></pitch><duration>18</duration><voice>2</voice><type>quarter</type><dot/></note>
  <note><pitch><step>A</step><octave>4</octave></pitch><duration>24</duration><voice>2</voice><type>half</type></note>
</measure>"""
    )
    assert normalize_sole_staff_voices_to_one_in_measure(m, "") is True
    for n in list_note_elements(m, ""):
        assert _note_voice_staff(n, "")[0] == "1"


def test_014f_pl_keeps_voice5() -> None:
    src = ROOT / "omr-work-014f2b6c.zip"
    if not src.exists():
        print("skip 014f")
        return
    out = ROOT / "_smoke" / "_014f_pr_pl_rests"
    out.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(src) as zf:
        (out / "review.mxl").write_bytes(zf.read("review.mxl"))
    stats = fix_mxl_file(out / "review.mxl", out / "fixed.mxl")
    # piano measures should not be counted in sole→1
    assert stats.get("sole_voice_to_one_measures", 0) < 37, stats

    with zipfile.ZipFile(out / "fixed.mxl") as zf:
        xmln = next(n for n in zf.namelist() if n.endswith(".xml") and not n.startswith("META"))
        root = ET.fromstring(zf.read(xmln))
    part = next(p for p in root.findall("part") if p.get("id") == "P5")
    sole_s2_v1 = 0
    sole_s2_v5 = 0
    for m in part.findall("measure"):
        voices: set[str] = set()
        for note in list_note_elements(m, ""):
            v, st = _note_voice_staff(note, "")
            if st == "2":
                voices.add(v)
        if voices == {"1"}:
            sole_s2_v1 += 1
        if voices == {"5"}:
            sole_s2_v5 += 1
    assert sole_s2_v1 == 0, f"PL sole voice1 measures={sole_s2_v1}"
    assert sole_s2_v5 >= 1, sole_s2_v5


if __name__ == "__main__":
    test_unit_skip_grand_staff()
    test_unit_satb_still_remaps()
    # ensure in_root still imported
    assert callable(normalize_sole_staff_voices_to_one_in_root)
    test_014f_pl_keeps_voice5()
    print("ok piano sole-voice skip (no PL phantom rests)")
