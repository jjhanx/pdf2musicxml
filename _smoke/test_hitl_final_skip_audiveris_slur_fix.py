#!/usr/bin/env python3
"""HITL preview skips fix_audiveris slur mutation; final must too (AUDIVERIS_MXL_SLUR_FIX=off).

Evidence (omr-work-014f2b6c): with slur fix on, m9 E5↔E5 and many other pitch-attached
slurs are moved to other chord members / replaced with number 20+ pairs MuseScore ignores.
"""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import _ns, _q, load_mxl_root  # noqa: E402
import fix_audiveris_mxl as fam  # noqa: E402

OUT = ROOT / "_smoke" / "_slur_hitl_final_parity"
OUT.mkdir(parents=True, exist_ok=True)


def extract_review() -> Path:
    import io
    import zipfile

    with zipfile.ZipFile(ROOT / "omr-work-014f2b6c.zip") as z:
        raw = z.read("review.mxl")
    p = OUT / "review.mxl"
    p.write_bytes(raw)
    return p


def slur_pitch_keys(path: Path) -> set[tuple]:
    files, rp, root = load_mxl_root(path)
    ns = _ns(root)
    keys: set[tuple] = set()
    for part in root.findall(_q(ns, "part")):
        pid = part.get("id") or ""
        for m in part.findall(_q(ns, "measure")):
            mnum = m.get("number") or ""
            for note in m.findall(_q(ns, "note")):
                staff = note.findtext(_q(ns, "staff")) or "1"
                pitch = note.find(_q(ns, "pitch"))
                if pitch is None:
                    continue
                lab = (pitch.findtext(_q(ns, "step")) or "") + (
                    pitch.findtext(_q(ns, "octave")) or ""
                )
                notations = note.find(_q(ns, "notations"))
                if notations is None:
                    continue
                for s in notations.findall(_q(ns, "slur")):
                    keys.add(
                        (
                            pid,
                            mnum,
                            staff,
                            (s.get("type") or ""),
                            (s.get("number") or "1"),
                            lab,
                        )
                    )
    return keys


def main() -> None:
    src = extract_review()
    before = slur_pitch_keys(src)

    # Default (final path without HITL flag): mutates — regression witness
    on_path = OUT / "fix_slur_on.mxl"
    shutil.copy(src, on_path)
    os.environ.pop("AUDIVERIS_MXL_SLUR_FIX", None)
    fam.fix_mxl_file(on_path, on_path)
    after_on = slur_pitch_keys(on_path)
    lost_on = before - after_on
    assert len(lost_on) > 0, "fixture should show slur pitch moves when slur fix on"
    assert any(k[1] == "9" for k in lost_on) or any(
        k[5] == "E5" and k[1] == "9" for k in lost_on
    ) or len(lost_on) >= 10

    # HITL-final parity: slur fix off — pitch attachments preserved
    off_path = OUT / "fix_slur_off.mxl"
    shutil.copy(src, off_path)
    os.environ["AUDIVERIS_MXL_SLUR_FIX"] = "off"
    stats = fam.fix_mxl_file(off_path, off_path)
    after_off = slur_pitch_keys(off_path)
    lost_off = before - after_off
    assert stats.get("slur_placements_fixed", 0) == 0, stats
    assert stats.get("chord_slurs_completed", 0) == 0, stats
    assert stats.get("continuation_slurs_added", 0) == 0, stats
    assert lost_off == set(), (len(lost_off), list(sorted(lost_off))[:20])

    print(
        "hitl final slur parity ok",
        {"lostWhenOn": len(lost_on), "lostWhenOff": len(lost_off)},
    )


if __name__ == "__main__":
    main()
