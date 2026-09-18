#!/usr/bin/env python3
"""Regress: multi-voice RH must keep inter-voice backup so PL does not sit on PR."""
from __future__ import annotations

import sys
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from restructure_mxl_parts import (  # noqa: E402
    build_rh_measure_from_misplaced,
    merge_rh_into_piano_measure,
    _ensure_staff_voice_backups,
    _fix_cross_staff_backup_duration,
)


def q(t: str) -> str:
    return t


def make_primary() -> ET.Element:
    m = ET.fromstring(
        """
    <measure number="8">
      <attributes><divisions>12</divisions></attributes>
      <note><pitch><step>C</step><octave>6</octave></pitch><duration>24</duration><voice>1</voice></note>
      <note><pitch><step>C</step><octave>6</octave></pitch><duration>12</duration><voice>1</voice></note>
      <note><rest/><duration>12</duration><voice>1</voice></note>
    </measure>
    """
    )
    return m


def make_secondary() -> ET.Element:
    return ET.fromstring(
        """
    <measure number="8">
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>24</duration><voice>1</voice></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>12</duration><voice>1</voice></note>
    </measure>
    """
    )


def make_lh() -> ET.Element:
    return ET.fromstring(
        """
    <measure number="8">
      <attributes><divisions>12</divisions>
        <clef><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>24</duration><voice>1</voice></note>
      <note><chord/><pitch><step>B</step><octave>3</octave></pitch><duration>24</duration><voice>1</voice></note>
      <note><pitch><step>C</step><octave>2</octave></pitch><duration>12</duration><voice>1</voice></note>
      <note><rest/><duration>12</duration><voice>1</voice></note>
    </measure>
    """
    )


def backups(m: ET.Element) -> list[int]:
    out = []
    for el in m:
        if el.tag.endswith("backup") or el.tag == "backup":
            d = el.find("duration")
            out.append(int(d.text or 0))
    return out


def main() -> None:
    ns = ""
    rh = build_rh_measure_from_misplaced(make_primary(), make_secondary(), ns)
    assert len(backups(rh)) == 1, backups(rh)
    assert backups(rh)[0] == 48, backups(rh)

    merged = merge_rh_into_piano_measure(make_lh(), rh, ns, divisions=12)
    bs = backups(merged)
    assert len(bs) >= 2, f"need inter-voice + cross-staff backups, got {bs}"
    assert bs[0] == 48, f"inter-voice backup should be 48, got {bs}"
    assert bs[-1] == 36, f"cross-staff backup should be v2 cursor 36, got {bs}"

    # Broken sequential (no inter-voice backup) → ensure inserts one
    broken = ET.fromstring(
        """
    <measure number="8">
      <attributes><divisions>12</divisions><staves>2</staves></attributes>
      <note><pitch><step>C</step><octave>6</octave></pitch><duration>24</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>C</step><octave>6</octave></pitch><duration>12</duration><voice>1</voice><staff>1</staff></note>
      <note><rest/><duration>12</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>24</duration><voice>2</voice><staff>1</staff></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>12</duration><voice>2</voice><staff>1</staff></note>
      <backup><duration>84</duration></backup>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>24</duration><voice>5</voice><staff>2</staff></note>
      <note><rest/><duration>24</duration><voice>5</voice><staff>2</staff></note>
    </measure>
    """
    )
    _ensure_staff_voice_backups(broken, ns, staff="1")
    _fix_cross_staff_backup_duration(broken, ns)
    bs2 = backups(broken)
    assert bs2[0] == 48, bs2
    assert bs2[-1] == 36, bs2
    print("test_merge_rh_preserves_voice_backup: OK", bs, bs2)


if __name__ == "__main__":
    main()
