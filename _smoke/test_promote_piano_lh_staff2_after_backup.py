#!/usr/bin/env python3
"""m9: piano LH after backup on staff1 must become staff2 when part is grand staff."""
from __future__ import annotations

import sys
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from fix_audiveris_mxl import _promote_backup_staff1_secondary_to_staff2  # noqa: E402
from restructure_mxl_parts import _promote_backup_staff1_secondary_to_staff2 as promote2  # noqa: E402


def test_promote() -> None:
    m = ET.fromstring(
        """
    <measure number="9">
      <note><pitch><step>F</step><octave>3</octave></pitch><duration>12</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>12</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>12</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>12</duration><voice>1</voice><staff>1</staff></note>
      <backup><duration>48</duration></backup>
      <note><pitch><step>F</step><octave>2</octave></pitch><duration>24</duration><voice>2</voice><staff>1</staff></note>
    </measure>
    """
    )
    n = _promote_backup_staff1_secondary_to_staff2(m, "")
    assert n == 1, n
    notes = m.findall("note")
    assert notes[-1].findtext("staff") == "2"
    assert notes[-1].findtext("voice") == "6"  # 2+4
    # RH unchanged
    assert all(n.findtext("staff") == "1" for n in notes[:-1])

    # Already has staff2 — no change
    m2 = ET.fromstring(
        """
    <measure number="8">
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>24</duration><voice>1</voice><staff>1</staff></note>
      <backup><duration>24</duration></backup>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>24</duration><voice>2</voice><staff>1</staff></note>
      <backup><duration>24</duration></backup>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>24</duration><voice>5</voice><staff>2</staff></note>
    </measure>
    """
    )
    assert _promote_backup_staff1_secondary_to_staff2(m2, "") == 0
    assert m2.findall("note")[1].findtext("staff") == "1"

    # restructure twin
    m3 = ET.fromstring(
        """
    <measure number="9">
      <note><pitch><step>F</step><octave>3</octave></pitch><duration>12</duration><voice>1</voice><staff>1</staff></note>
      <backup><duration>12</duration></backup>
      <note><pitch><step>F</step><octave>2</octave></pitch><duration>12</duration><voice>2</voice><staff>1</staff></note>
    </measure>
    """
    )
    assert promote2(m3, "") == 1
    assert m3.findall("note")[-1].findtext("staff") == "2"
    print("test_promote_piano_lh_staff2_after_backup: OK")


if __name__ == "__main__":
    test_promote()
