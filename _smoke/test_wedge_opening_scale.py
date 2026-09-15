"""amplify_wedge_spreads: MuseScore reads start.spread as hairpinHeight (tenths/10)."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from omr_hitl_lib import amplify_wedge_spreads_for_visibility_in_root  # noqa: E402


def test_crescendo_sets_start_spread_for_musescore() -> None:
    root = ET.fromstring(
        """<score-partwise>
  <part id="P1">
    <measure number="1">
      <direction><direction-type><wedge type="crescendo" spread="0"/></direction-type><staff>1</staff></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note>
      <direction><direction-type><wedge type="stop" spread="15"/></direction-type><staff>1</staff></direction>
    </measure>
  </part>
</score-partwise>"""
    )
    n = amplify_wedge_spreads_for_visibility_in_root(root)
    assert n >= 1
    start = root.find(".//wedge[@type='crescendo']")
    stop = root.find(".//wedge[@type='stop']")
    assert start is not None and stop is not None
    # 3 notes → 14+2*3=20, 상한 30 (예전 stop-only 40~60 / 마디 분할 금지)
    s = int(start.get("spread") or "0")
    t = int(stop.get("spread") or "0")
    assert 16 <= s <= 30, s
    assert 16 <= t <= 30, t
    assert s == t


def test_long_span_capped_not_sixty() -> None:
    notes = "".join(
        f"<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>"
        for _ in range(12)
    )
    root = ET.fromstring(
        f"""<score-partwise>
  <part id="P1">
    <measure number="1">
      <direction><direction-type><wedge type="crescendo" spread="0"/></direction-type><staff>1</staff></direction>
      {notes}
      <direction><direction-type><wedge type="stop" spread="15"/></direction-type><staff>1</staff></direction>
    </measure>
  </part>
</score-partwise>"""
    )
    amplify_wedge_spreads_for_visibility_in_root(root)
    start = root.find(".//wedge[@type='crescendo']")
    assert start is not None
    assert int(start.get("spread") or "0") == 30


def test_osmd_patch_present() -> None:
    minjs = ROOT / "node_modules" / "opensheetmusicdisplay" / "build" / "opensheetmusicdisplay.min.js"
    if not minjs.exists():
        print("skip osmd patch check (no min.js)")
        return
    text = minjs.read_text(encoding="utf-8", errors="ignore")
    assert "Math.min(Math.abs(e-t)*.5,14)" in text, "OSMD length-scaled wedge opening patch missing — run npm i / postinstall"


if __name__ == "__main__":
    test_crescendo_sets_start_spread_for_musescore()
    test_long_span_capped_not_sixty()
    test_osmd_patch_present()
    print("ok wedge_opening_scale")
