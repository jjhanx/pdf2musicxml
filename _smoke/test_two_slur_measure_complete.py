#!/usr/bin/env python3
"""Two slurs/measure: complete orphan chord stops (m55) + duration←type (m50 voice6)."""
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
    coerce_note_durations_to_type_in_root,
    list_note_elements,
    normalize_slurs_in_root,
    _note_duration,
)


def load_review() -> ET.Element:
    with zipfile.ZipFile(ROOT / "omr-work-014f2b6c.zip") as z:
        raw = z.read("review.mxl")
    with zipfile.ZipFile(io.BytesIO(raw)) as mz:
        name = next(n for n in mz.namelist() if n.endswith(".xml") and "META" not in n.upper())
        return ET.fromstring(mz.read(name))


def slur_pairs_staff(root: ET.Element, mnum: str, staff: str) -> list[tuple]:
    ns = _ns(root)
    part = next(p for p in root.findall(_q(ns, "part")) if p.get("id") == "P5")
    m = next(x for x in part.findall(_q(ns, "measure")) if x.get("number") == mnum)
    notes = list_note_elements(m, ns)
    open_at: dict[str, tuple] = {}
    pairs = []
    for i, n in enumerate(notes):
        if (n.findtext(_q(ns, "staff")) or "1") != staff:
            continue
        notations = n.find(_q(ns, "notations"))
        if notations is None:
            continue
        pitch = n.find(_q(ns, "pitch"))
        lab = (
            (pitch.findtext(_q(ns, "step")) or "")
            + (pitch.findtext(_q(ns, "octave")) or "")
            if pitch is not None
            else "rest"
        )
        for s in notations.findall(_q(ns, "slur")):
            num = s.get("number") or "1"
            t = s.get("type")
            if t == "start":
                open_at[num] = (i, lab, s.get("placement"))
            elif t == "stop" and num in open_at:
                pairs.append((num, open_at.pop(num), (i, lab, s.get("placement"))))
    orphans = list(open_at.items())
    return pairs, orphans


def main() -> None:
    root = load_review()
    pairs_before, orphans_before = slur_pairs_staff(root, "55", "1")
    assert orphans_before, f"fixture m55 should have orphan start, got {pairs_before}"
    assert any(n == "2" for n, _ in orphans_before), orphans_before

    n = normalize_slurs_in_root(root)
    pairs_after, orphans_after = slur_pairs_staff(root, "55", "1")
    assert not orphans_after, orphans_after
    nums = {p[0] for p in pairs_after}
    assert "1" in nums and "2" in nums and "3" in nums, pairs_after
    # n2 should close on E5
    n2 = next(p for p in pairs_after if p[0] == "2")
    assert n2[1][1] == "E5" and n2[2][1] == "E5", n2
    assert n2[2][2] == "below", n2  # placement copied

    # m50 voice6 half duration coerced
    root2 = load_review()
    ns = _ns(root2)
    part = next(p for p in root2.findall(_q(ns, "part")) if p.get("id") == "P5")
    m = next(x for x in part.findall(_q(ns, "measure")) if x.get("number") == "50")
    v6 = [
        n
        for n in list_note_elements(m, ns)
        if (n.findtext(_q(ns, "voice")) or "") == "6"
        and n.find(_q(ns, "pitch")) is not None
    ]
    half = next(n for n in v6 if (n.findtext(_q(ns, "type")) or "") == "half")
    assert _note_duration(half, ns) == 2  # broken before
    coerce_note_durations_to_type_in_root(root2)
    assert _note_duration(half, ns) == 8, _note_duration(half, ns)

    # m53/m54 still have two complete PR pairs after normalize
    root3 = load_review()
    normalize_slurs_in_root(root3)
    for mnum in ("53", "54"):
        pairs, orphans = slur_pairs_staff(root3, mnum, "1")
        assert not orphans, (mnum, orphans)
        assert len(pairs) >= 2, (mnum, pairs)

    print(
        "two-slur measure fix ok",
        {"m55pairs": len(pairs_after), "normalizeChanged": n, "halfDur": _note_duration(half, ns)},
    )


if __name__ == "__main__":
    main()
