#!/usr/bin/env python3
"""inject_ocr must not re-run fix_audiveris slur mutation (preview↔final parity).

Regression: postprocess skipped slur fix, then inject_ocr called fix_mxl_file with
default slur ON → number 20+ / moved chord slurs → MuseScore blank.
"""
from __future__ import annotations

import io
import os
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import _ns, _q, load_mxl_root  # noqa: E402
from inject_ocr import _run_audiveris_mxl_fix  # noqa: E402

OUT = ROOT / "_smoke" / "_slur_inject_ocr_parity"
OUT.mkdir(parents=True, exist_ok=True)


def slur_keys(path: Path) -> set[tuple]:
    _f, _rp, root = load_mxl_root(path)
    ns = _ns(root)
    keys: set[tuple] = set()
    for part in root.findall(_q(ns, "part")):
        pid = part.get("id") or ""
        for m in part.findall(_q(ns, "measure")):
            mnum = m.get("number") or ""
            for note in m.findall(_q(ns, "note")):
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
                    num = s.get("number") or "1"
                    keys.add((pid, mnum, s.get("type") or "", num, lab))
    return keys


def main() -> None:
    with zipfile.ZipFile(ROOT / "omr-work-014f2b6c.zip") as z:
        raw = z.read("review.mxl")
    src = OUT / "review.mxl"
    src.write_bytes(raw)
    before = slur_keys(src)

    # Simulate inject_ocr's fix call with clean env (no AUDIVERIS_MXL_SLUR_FIX)
    work = OUT / "after_inject_fix.mxl"
    shutil.copy(src, work)
    for k in list(os.environ):
        if k.startswith("AUDIVERIS_MXL_SLUR"):
            os.environ.pop(k, None)
    ok = _run_audiveris_mxl_fix(str(src), str(work))
    assert ok, "inject fix should succeed"
    after = slur_keys(work)
    lost = before - after
    high_before = {k for k in before if k[3].isdigit() and int(k[3]) > 6}
    high_after = {k for k in after if k[3].isdigit() and int(k[3]) > 6}
    high_gained = high_after - high_before
    assert lost == set(), (len(lost), sorted(lost)[:15])
    assert high_gained == set(), list(sorted(high_gained))[:10]
    assert os.environ.get("AUDIVERIS_MXL_SLUR_FIX") == "off"

    print(
        "inject_ocr slur parity ok",
        {
            "before": len(before),
            "after": len(after),
            "highKept": len(high_after),
            "highGained": len(high_gained),
        },
    )


if __name__ == "__main__":
    main()
