#!/usr/bin/env python3
"""bf4e4741 P5 m7 PL #12–#14 세잇단 — time-mod·tuplet·stem default-y 제거 회귀."""
from __future__ import annotations

import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import omr_hitl_lib as L  # noqa: E402

OUT = ROOT / "_smoke" / "_bf4e_m7_triplet"
ZIP = ROOT / "omr-work-bf4e4741.zip"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    if ZIP.is_file():
        with zipfile.ZipFile(ZIP) as z:
            z.extract("review.mxl", OUT)
        work = OUT / "work.mxl"
        shutil.copy(OUT / "review.mxl", work)
    else:
        # CI without zip: minimal PL beam+stem-default-y fixture
        xml = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P5">
    <measure number="7">
      <attributes><divisions>24</divisions><staves>2</staves>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>96</duration>
        <voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>96</duration></backup>
      <note><pitch><step>A</step><octave>3</octave></pitch><duration>6</duration>
        <voice>1</voice><type>16th</type><stem default-y="119">up</stem><staff>2</staff>
        <beam number="1">begin</beam></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>6</duration>
        <voice>1</voice><type>16th</type><stem>up</stem><staff>2</staff>
        <beam number="1">continue</beam></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>6</duration>
        <voice>1</voice><type>16th</type><stem>up</stem><staff>2</staff>
        <beam number="1">end</beam></note>
      <note><pitch><step>F</step><octave>2</octave></pitch><duration>78</duration>
        <voice>1</voice><type>half</type><dot/><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>"""
        work = OUT / "work.mxl"
        files = {
            "META-INF/container.xml": (
                b'<?xml version="1.0"?><container><rootfiles>'
                b'<rootfile full-path="score.xml"/></rootfiles></container>'
            ),
            "score.xml": xml.encode("utf-8"),
        }
        import xml.etree.ElementTree as ET

        L.write_mxl_root(work, files, "score.xml", ET.fromstring(xml))
        from_i, to_i = 1, 3

    if ZIP.is_file():
        from_i, to_i = 12, 14

    stats = L.apply_fixes_file(
        work,
        [
            {
                "kind": "applyTriplet",
                "partId": "P5",
                "measureMxl": "7",
                "fromNoteIndex": from_i,
                "toNoteIndex": to_i,
                "actualNotes": 3,
                "normalNotes": 2,
                "normalType": "16th",
                "staff": 2,
            }
        ],
        skip_octave_repair=True,
    )
    assert stats.get("applied") == 1, stats

    _, _, root = L.load_mxl_root(work)
    ns = L._ns(root)
    part = L.find_part(root, ns, "P5")
    measure = L.find_measure(part, ns, "7")
    assert measure is not None
    notes = L.list_note_elements(measure, ns)

    for i in (from_i, from_i + 1, to_i):
        n = notes[i]
        tm = n.find(L._q(ns, "time-modification"))
        assert tm is not None, f"#{i} missing time-modification"
        assert (tm.find(L._q(ns, "actual-notes")).text or "") == "3"
        assert (tm.find(L._q(ns, "normal-notes")).text or "") == "2"
        assert int(n.find(L._q(ns, "duration")).text) == 4
        stem = n.find(L._q(ns, "stem"))
        assert stem is not None
        assert "default-y" not in stem.attrib, f"#{i} stem default-y should be cleared"
        assert "default-x" not in stem.attrib
        children = [L._local(c) for c in n]
        if "beam" in children:
            assert children.index("time-modification") < children.index("beam")

    start = notes[from_i].find(L._q(ns, "notations"))
    assert start is not None
    tup = start.find(L._q(ns, "tuplet"))
    assert tup is not None and tup.get("type") == "start"
    assert tup.get("show-number") == "actual"

    # staff hint → staff-2 only rebuild path still keeps tuplet
    hint = L._staff_hint_from_fix(
        {"kind": "applyTriplet", "fromNoteIndex": from_i, "staff": 2}, notes, ns
    )
    assert hint == "2"
    hint2 = L._staff_hint_from_fix(
        {"kind": "applyTriplet", "fromNoteIndex": from_i}, notes, ns
    )
    assert hint2 == "2", hint2

    print("OK PL m7 #12-14 applyTriplet keeps tuplet and clears stem default-y")


if __name__ == "__main__":
    main()
