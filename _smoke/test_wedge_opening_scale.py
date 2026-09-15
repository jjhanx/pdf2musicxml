"""amplify_wedge_spreads raises stop spread for multi-note crescendo."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from omr_hitl_lib import amplify_wedge_spreads_for_visibility_in_root  # noqa: E402


def test_crescendo_spread_grows_with_notes() -> None:
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
    stop = root.find(".//wedge[@type='stop']")
    assert stop is not None
    assert int(stop.get("spread") or "0") >= 40  # 20+10*3


def test_osmd_patch_present() -> None:
    minjs = ROOT / "node_modules" / "opensheetmusicdisplay" / "build" / "opensheetmusicdisplay.min.js"
    if not minjs.exists():
        print("skip osmd patch check (no min.js)")
        return
    text = minjs.read_text(encoding="utf-8", errors="ignore")
    assert "Math.min(Math.abs(e-t)*.5,14)" in text, "OSMD length-scaled wedge opening patch missing — run npm i / postinstall"
    assert "_n=Math.max(n,Math.min(_len*.5,14))" in text, "OSMD second-half crescendo opening patch missing"


if __name__ == "__main__":
    test_crescendo_spread_grows_with_notes()
    test_osmd_patch_present()
    print("ok wedge opening amplify + osmd patch")
