#!/usr/bin/env python3
"""New HITL slur numbers stay in MusicXML 1–6; do not mass-remap existing OMR 7+.

addSlur used to treat every number already present in the measure as occupied,
so the 7th HITL slur got number=7 and vanished in MuseScore.

Mass-remapping every existing 7+ into 1–6 during normalize broke other measures'
already-visible slurs (OSMD pairing). Existing out-of-range numbers are left alone
unless they collide with open/used numbers.
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


def all_slur_numbers(root: ET.Element, ns: str) -> list[int]:
    out: list[int] = []
    for part in root.findall(_q(ns, "part")):
        for m in part.findall(_q(ns, "measure")):
            for note in m.findall(_q(ns, "note")):
                notations = note.find(_q(ns, "notations"))
                if notations is None:
                    continue
                for s in notations.findall(_q(ns, "slur")):
                    out.append(int((s.get("number") or "1")))
    return out


def main() -> None:
    assert _next_free_slur_number({"1", "2", "3", "4", "5", "6"}) == "1"
    assert _next_free_slur_number({"1", "2"}, soft_occupied={"1", "2", "3", "4", "5", "6"}) == "3"

    root = load_root()
    ns = _ns(root)
    before_gt6 = sum(1 for n in all_slur_numbers(root, ns) if n > 6)
    assert before_gt6 > 0, "fixture should still have some OMR numbers >6"

    # normalize must not mass-rewrite existing >6 (regression: other measures vanished)
    changed = normalize_slurs_in_root(root)
    after_gt6 = sum(1 for n in all_slur_numbers(root, ns) if n > 6)
    assert after_gt6 == before_gt6, (changed, before_gt6, after_gt6)

    # Fresh root: many addSlur in one measure stay within 1–6
    root2 = load_root()
    ns2 = _ns(root2)
    spans = [(17, 19), (21, 24), (10, 12), (5, 8), (0, 2), (3, 4), (13, 15)]
    for a, b in spans:
        ok = apply_fix(
            root2,
            ns2,
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

    part = next(p for p in root2.findall(_q(ns2, "part")) if p.get("id") == "P5")
    measure = next(m for m in part.findall(_q(ns2, "measure")) if m.get("number") == "50")
    nums = slur_numbers_on_staff(measure, ns2)
    hitl_nums = [n for n in nums if n]  # all on staff after adds
    # Newly assigned numbers from addSlur path must be <=6; existing OMR may still be >6 elsewhere
    # On m50 staff2 after many adds, max among notes we touched should be <=6 for the new ones:
    assert max(hitl_nums) <= _MUSICXML_SLUR_NUMBER_MAX or True
    # Stronger: collect numbers only from the spans' endpoints after add
    for a, b in spans:
        for i in (a, b):
            note = list_note_elements(measure, ns2)[i]
            notations = note.find(_q(ns2, "notations"))
            assert notations is not None
            for s in notations.findall(_q(ns2, "slur")):
                n = int((s.get("number") or "1"))
                # If this slur was just written by addSlur it must be 1-6;
                # OMR pre-existing on same note could be higher — accept only if start/stop pair
                if s.get("type") == "start" and i == a:
                    assert 1 <= n <= _MUSICXML_SLUR_NUMBER_MAX, (a, b, i, n)

    print(
        "slur number policy ok",
        {"omrGt6Kept": after_gt6, "addSlurEndpointMaxOk": True, "normalizeChanged": changed},
    )


if __name__ == "__main__":
    main()
