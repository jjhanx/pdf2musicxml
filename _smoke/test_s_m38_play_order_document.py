"""S m38: play-order document order + orphan 8va removed (not closed)."""
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
    PLAY_ORDER_ATTR,
    materialize_play_order_document_order_in_root,
    repair_orphan_octave_shifts_in_root,
)


def _notes(m: ET.Element) -> list[tuple[str, int | None]]:
    out: list[tuple[str, int | None]] = []
    for n in m.findall("note"):
        if n.find("chord") is not None:
            continue
        pitch = n.find("pitch")
        p = f"{pitch.findtext('step')}{pitch.findtext('octave')}" if pitch is not None else "REST"
        raw = n.get(PLAY_ORDER_ATTR)
        po = int(raw) if raw and raw.isdigit() else None
        out.append((p, po))
    return out


def test_unit_materialize_and_orphan() -> None:
    root = ET.fromstring(
        """<score-partwise version="3.1">
<part id="P1">
  <measure number="38">
    <attributes><divisions>12</divisions></attributes>
    <note data-hitl-play-order="4"><pitch><step>C</step><octave>5</octave></pitch><duration>12</duration><voice>1</voice><type>eighth</type></note>
    <note data-hitl-play-order="1"><pitch><step>A</step><octave>4</octave></pitch><duration>36</duration><voice>1</voice><type>quarter</type><dot/></note>
    <note data-hitl-play-order="2"><pitch><step>C</step><octave>5</octave></pitch><duration>12</duration><voice>1</voice><type>eighth</type></note>
    <note data-hitl-play-order="3"><pitch><step>D</step><octave>5</octave></pitch><duration>36</duration><voice>1</voice><type>quarter</type><dot/></note>
  </measure>
  <measure number="39">
    <direction placement="above"><direction-type><octave-shift type="up" size="8" number="1">8va</octave-shift></direction-type></direction>
    <note><pitch><step>C</step><octave>5</octave></pitch><duration>12</duration><voice>1</voice><type>eighth</type></note>
  </measure>
</part>
</score-partwise>"""
    )
    assert materialize_play_order_document_order_in_root(root) >= 1
    m38 = root.find("./part/measure[@number='38']")
    assert m38 is not None
    assert [p for p, _ in _notes(m38)] == ["A4", "C5", "D5", "C5"], _notes(m38)
    assert [po for _, po in _notes(m38)] == [1, 2, 3, 4]

    n = repair_orphan_octave_shifts_in_root(root)
    assert n >= 1
    m39 = root.find("./part/measure[@number='39']")
    assert m39 is not None
    assert m39.find(".//octave-shift") is None, ET.tostring(m39, encoding="unicode")


def test_014f_final() -> None:
    src = ROOT / "omr-work-014f2b6c.zip"
    if not src.exists():
        print("skip 014f")
        return
    out = ROOT / "_smoke" / "_014f_s_m38_order"
    out.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(src) as zf:
        (out / "review.mxl").write_bytes(zf.read("review.mxl"))
    fix_mxl_file(out / "review.mxl", out / "fixed.mxl")
    with zipfile.ZipFile(out / "fixed.mxl") as zf:
        xmln = next(n for n in zf.namelist() if n.endswith(".xml") and not n.startswith("META"))
        root = ET.fromstring(zf.read(xmln))
    part = next(p for p in root.findall("part") if p.get("id") == "P1")
    m38 = next(m for m in part.findall("measure") if m.get("number") == "38")
    pitches = []
    for n in m38.findall("note"):
        if n.find("chord") is not None:
            continue
        pitch = n.find("pitch")
        pitches.append(f"{pitch.findtext('step')}{pitch.findtext('octave')}")
    assert pitches == ["A4", "C5", "D5", "C5"], pitches
    m39 = next(m for m in part.findall("measure") if m.get("number") == "39")
    assert m39.find(".//octave-shift") is None


if __name__ == "__main__":
    test_unit_materialize_and_orphan()
    test_014f_final()
    print("ok s m38 play-order document order + orphan 8va removed")
