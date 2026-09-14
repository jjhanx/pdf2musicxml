#!/usr/bin/env python3
"""MusicXML slur number must stay in 1–6 (MuseScore ignores 7+).

addSlur used to treat every number already present in the measure as occupied,
so the 7th HITL slur got number=7 and vanished in MuseScore even though XML
had a complete start/stop pair.
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
    _MUSICXML_SLUR_NUMBER_MAX,
    _ns,
    _next_free_slur_number,
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


def slur_numbers_on_staff(measure: ET.Element, ns: str, staff: str = "2") -> list[int]:
    out: list[int] = []
    for note in list_note_elements(measure, ns):
        if (note.findtext(_q(ns, "staff")) or "1") != staff:
            continue
        notations = note.find(_q(ns, "notations"))
        if notations is None:
            continue
        for s in notations.findall(_q(ns, "slur")):
            n = (s.get("number") or "1").strip() or "1"
            assert n.isdigit(), n
            out.append(int(n))
    return out


def main() -> None:
    assert _next_free_slur_number({"1", "2", "3", "4", "5", "6"}) == "1"
    assert _next_free_slur_number({"1", "2"}, soft_occupied={"1", "2", "3", "4", "5", "6"}) == "3"
    assert _next_free_slur_number(set(), soft_occupied={"1", "2", "3", "4", "5", "6"}) in {
        str(i) for i in range(1, _MUSICXML_SLUR_NUMBER_MAX + 1)
    }

    root = load_root()
    ns = _ns(root)
    spans = [(17, 19), (21, 24), (10, 12), (5, 8), (0, 2), (3, 4), (13, 15)]
    for a, b in spans:
        ok = apply_fix(
            root,
            ns,
            {
                "kind": "addSlur",
                "partId": "P5",
                "measureMxl": "50",
                "fromNoteIndex": a,
                "toNoteIndex": b,
                "placement": "above",
            },
        )
        assert ok, (a, b)

    part = next(p for p in root.findall(_q(ns, "part")) if p.get("id") == "P5")
    measure = next(m for m in part.findall(_q(ns, "measure")) if m.get("number") == "50")
    nums = slur_numbers_on_staff(measure, ns)
    assert nums, "expected HITL slurs"
    assert max(nums) <= _MUSICXML_SLUR_NUMBER_MAX, nums

    normalize_slurs_in_root(root)
    nums2 = slur_numbers_on_staff(measure, ns)
    assert nums2 and max(nums2) <= _MUSICXML_SLUR_NUMBER_MAX, nums2

    # Existing OMR numbers >6 must be remapped into 1–6
    root2 = load_root()
    ns2 = _ns(root2)
    n = normalize_slurs_in_root(root2)
    all_nums: list[int] = []
    for part in root2.findall(_q(ns2, "part")):
        for m in part.findall(_q(ns2, "measure")):
            for note in m.findall(_q(ns2, "note")):
                notations = note.find(_q(ns2, "notations"))
                if notations is None:
                    continue
                for s in notations.findall(_q(ns2, "slur")):
                    all_nums.append(int((s.get("number") or "1")))
    assert all_nums, "score should have slurs"
    assert max(all_nums) <= _MUSICXML_SLUR_NUMBER_MAX, (n, max(all_nums), all_nums[:20])
    print("slur number MusicXML max ok", {"addSlurMax": max(nums), "normalizeMax": max(all_nums)})


if __name__ == "__main__":
    main()
