"""Final MXL: sole voice→1 (no MuseScore phantom whole rest) + leading wedge stop reanchor."""
from __future__ import annotations

import shutil
import sys
import zipfile
import xml.etree.ElementTree as ET
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from fix_audiveris_mxl import fix_mxl_file  # noqa: E402
from omr_hitl_lib import (  # noqa: E402
    normalize_sole_staff_voices_to_one_in_root,
    reanchor_leading_wedge_stops_in_root,
    repair_directions_between_chord_notes_in_root,
)


def _q(ns: str, tag: str) -> str:
    return f"{{{ns}}}{tag}" if ns else tag


def _ns(root: ET.Element) -> str:
    return root.tag.split("}")[0][1:] if root.tag.startswith("{") else ""


def _load_mxl(path: Path) -> ET.Element:
    with zipfile.ZipFile(path) as zf:
        name = next(n for n in zf.namelist() if n.endswith(".xml") and not n.startswith("META"))
        return ET.fromstring(zf.read(name))


def test_unit_sole_voice_and_leading_stop() -> None:
    root = ET.fromstring(
        """<score-partwise version="3.1">
<part id="P1">
  <measure number="60">
    <attributes><divisions>12</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    <note><pitch><step>B</step><octave>3</octave></pitch><duration>6</duration><voice>2</voice><type>eighth</type></note>
    <direction placement="above"><direction-type><wedge type="crescendo" number="1" spread="0"/></direction-type><voice>2</voice></direction>
    <note><pitch><step>B</step><octave>3</octave></pitch><duration>18</duration><voice>2</voice><type>quarter</type><dot/></note>
    <note><pitch><step>B</step><octave>3</octave></pitch><duration>24</duration><voice>2</voice><type>half</type></note>
  </measure>
  <measure number="61">
    <direction placement="above"><direction-type><wedge type="stop" number="1" spread="15"/></direction-type><voice>1</voice></direction>
    <note><pitch><step>B</step><octave>3</octave></pitch><duration>36</duration><voice>1</voice><type>half</type></note>
    <note><pitch><step>E</step><octave>3</octave></pitch><duration>6</duration><voice>1</voice><type>eighth</type></note>
    <note><pitch><step>G</step><octave>3</octave></pitch><duration>6</duration><voice>1</voice><type>eighth</type></note>
  </measure>
</part>
</score-partwise>"""
    )
    assert normalize_sole_staff_voices_to_one_in_root(root) >= 1
    m60 = root.find("./part/measure[@number='60']")
    assert m60 is not None
    for note in m60.findall("note"):
        assert (note.findtext("voice") or "") == "1"
    assert reanchor_leading_wedge_stops_in_root(root) == 1
    m61 = root.find("./part/measure[@number='61']")
    assert m61 is not None
    kids = list(m61)
    stop_i = next(
        i
        for i, el in enumerate(kids)
        if el.tag == "direction"
        and el.find("direction-type/wedge") is not None
        and el.find("direction-type/wedge").get("type") == "stop"
    )
    first_note_i = next(i for i, el in enumerate(kids) if el.tag == "note")
    assert stop_i > first_note_i, (stop_i, first_note_i, [el.tag for el in kids])


def test_unit_chord_gap_direction() -> None:
    root = ET.fromstring(
        """<score-partwise version="3.1">
<part id="P1">
  <measure number="1">
    <note><pitch><step>D</step><octave>5</octave></pitch><duration>36</duration><voice>1</voice><type>half</type></note>
    <direction placement="above"><direction-type><dynamics><f/></dynamics></direction-type></direction>
    <note><chord/><pitch><step>E</step><octave>5</octave></pitch><duration>36</duration><voice>1</voice><type>half</type></note>
    <direction placement="above"><direction-type><wedge type="stop" number="1" spread="15"/></direction-type></direction>
  </measure>
</part>
</score-partwise>"""
    )
    assert repair_directions_between_chord_notes_in_root(root) >= 1
    m = root.find("./part/measure[@number='1']")
    assert m is not None
    tags = []
    for el in m:
        if el.tag == "note":
            tags.append("chord" if el.find("chord") is not None else "note")
        elif el.tag == "direction":
            w = el.find("direction-type/wedge")
            if w is not None:
                tags.append(f"wedge:{w.get('type')}")
            else:
                tags.append("dyn")
    # f before chord group; contiguous note+chord; stop after
    assert tags.index("dyn") < tags.index("note")
    assert tags.index("note") + 1 == tags.index("chord")
    assert tags.index("wedge:stop") > tags.index("chord")


def test_014f_final_pipeline() -> None:
    src = ROOT / "omr-work-014f2b6c.zip"
    if not src.exists():
        print("skip 014f fixture")
        return
    out = ROOT / "_smoke" / "_014f_m60_fix"
    out.mkdir(parents=True, exist_ok=True)
    review = out / "review.mxl"
    fixed = out / "fixed.mxl"
    with zipfile.ZipFile(src) as zf:
        review.write_bytes(zf.read("review.mxl"))
    shutil.copy(review, fixed)
    stats = fix_mxl_file(review, fixed)
    assert stats.get("sole_voice_to_one_measures", 0) >= 1, stats
    assert stats.get("leading_wedge_stops_reanchored", 0) >= 1, stats

    root = _load_mxl(fixed)
    ns = _ns(root)
    q = lambda t: _q(ns, t)

    def part_by_name(name: str) -> ET.Element:
        labels = {}
        for sp in root.iter(q("score-part")):
            pn = sp.find(q("part-name"))
            labels[(pn.text or "").strip()] = sp.get("id")
        pid = labels[name]
        return next(p for p in root.findall(q("part")) if p.get("id") == pid)

    for pname in ("A", "T", "B"):
        part = part_by_name(pname)
        m60 = next(m for m in part.findall(q("measure")) if m.get("number") == "60")
        voices = {
            (n.findtext(q("voice")) or "1").strip()
            for n in m60.findall(q("note"))
            if n.find(q("grace")) is None
        }
        assert voices == {"1"}, (pname, voices)

    b = part_by_name("B")
    m61 = next(m for m in b.findall(q("measure")) if m.get("number") == "61")
    kids = list(m61)
    stop_i = None
    first_note_i = None
    for i, el in enumerate(kids):
        tag = el.tag.split("}")[-1]
        if tag == "note" and first_note_i is None:
            first_note_i = i
        if tag != "direction":
            continue
        for dt in el.findall(q("direction-type")):
            w = dt.find(q("wedge"))
            if w is not None and (w.get("type") or "") == "stop":
                stop_i = i
    assert stop_i is not None and first_note_i is not None
    assert stop_i > first_note_i, (stop_i, first_note_i)


if __name__ == "__main__":
    test_unit_sole_voice_and_leading_stop()
    test_unit_chord_gap_direction()
    test_014f_final_pipeline()
    print("ok m60 phantom rest + crescendo final")
