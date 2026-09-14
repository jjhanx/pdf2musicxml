#!/usr/bin/env python3
"""Sequential addSlur must not erase earlier slur stops in the mid range.

omr-work-014f2b6c m50 PL: #17→#19 then another slur whose span includes #19
used to clear the first stop → orphan start → missing in final MXL/MuseScore.
"""
from __future__ import annotations

import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import (  # noqa: E402
    _ns,
    _q,
    apply_fix,
    list_note_elements,
    normalize_slurs_in_root,
)


def load_root() -> ET.Element:
    with zipfile.ZipFile(ROOT / "omr-work-014f2b6c.zip") as z:
        raw = z.read("review.mxl")
    with zipfile.ZipFile(io.BytesIO(raw)) as mz:
        name = next(n for n in mz.namelist() if n.endswith(".xml") and "META" not in n.upper())
        return ET.fromstring(mz.read(name))


def slur_rows(measure: ET.Element, ns: str, staff: str = "2") -> list[str]:
    rows: list[str] = []
    for i, note in enumerate(list_note_elements(measure, ns)):
        if (note.findtext(_q(ns, "staff")) or "1") != staff:
            continue
        notations = note.find(_q(ns, "notations"))
        if notations is None:
            continue
        for s in notations.findall(_q(ns, "slur")):
            pitch = note.find(_q(ns, "pitch"))
            lab = (
                f"{pitch.findtext(_q(ns, 'step'))}{pitch.findtext(_q(ns, 'octave'))}"
                if pitch is not None
                else "rest"
            )
            rows.append(f"#{i} {lab} {s.get('type')} n{s.get('number')}")
    return rows


def main() -> None:
    root = load_root()
    ns = _ns(root)
    part = next(p for p in root.findall(_q(ns, "part")) if p.get("id") == "P5")
    measure = next(m for m in part.findall(_q(ns, "measure")) if m.get("number") == "50")

    assert apply_fix(
        root,
        ns,
        {
            "kind": "addSlur",
            "partId": "P5",
            "measureMxl": "50",
            "fromNoteIndex": 17,
            "toNoteIndex": 19,
            "placement": "above",
        },
    )
    rows1 = slur_rows(measure, ns)
    assert any("C3 start" in r for r in rows1), rows1
    assert any("A3 stop" in r for r in rows1), rows1

    # Second slur whose interior includes #19 (first slur's stop)
    assert apply_fix(
        root,
        ns,
        {
            "kind": "addSlur",
            "partId": "P5",
            "measureMxl": "50",
            "fromNoteIndex": 18,
            "toNoteIndex": 21,
            "placement": "above",
        },
    )
    rows2 = slur_rows(measure, ns)
    assert any("A3 stop" in r for r in rows2), f"first slur stop must survive: {rows2}"
    assert any("C3 start" in r for r in rows2), rows2
    assert any("#18" in r and "start" in r for r in rows2), rows2
    assert any("#21" in r and "stop" in r for r in rows2), rows2

    normalize_slurs_in_root(root)
    rows3 = slur_rows(measure, ns)
    assert any("A3 stop" in r for r in rows3), f"after normalize: {rows3}"
    assert any("C3 start" in r for r in rows3), rows3
    print("ok sequential addSlur preserves earlier stops", rows3)


if __name__ == "__main__":
    main()
