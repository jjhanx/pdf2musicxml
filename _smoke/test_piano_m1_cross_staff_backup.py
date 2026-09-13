#!/usr/bin/env python3
"""P5 m1: missing cross-staff backup → PL whole at onset after PR (phantom PR rest look)."""
from __future__ import annotations

import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "_smoke" / "_bf4e_m1_fix"
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import (  # noqa: E402
    _local,
    _note_duration,
    _note_voice_staff,
    _ns,
    load_mxl_root,
)
from fix_audiveris_mxl import fix_mxl_file  # noqa: E402


def staff2_onset(path: Path) -> int | None:
    files, rp, root = load_mxl_root(path)
    ns = _ns(root)
    for part in root:
        if _local(part) != "part" or part.get("id") != "P5":
            continue
        for m in part:
            if _local(m) != "measure" or m.get("number") != "1":
                continue
            cursor = 0
            for el in m:
                tag = _local(el)
                if tag == "note":
                    if any(_local(c) == "chord" for c in el):
                        continue
                    _v, st = _note_voice_staff(el, ns)
                    d = _note_duration(el, ns)
                    if st == "2":
                        return cursor
                    cursor += d
                elif tag == "backup":
                    d = 0
                    for c in el:
                        if _local(c) == "duration" and c.text:
                            d = int(c.text)
                    cursor = max(0, cursor - d)
                elif tag == "forward":
                    d = 0
                    for c in el:
                        if _local(c) == "duration" and c.text:
                            d = int(c.text)
                    cursor += d
    return None


def has_backup_m1(path: Path) -> bool:
    files, rp, root = load_mxl_root(path)
    ns = _ns(root)
    for part in root:
        if _local(part) != "part" or part.get("id") != "P5":
            continue
        for m in part:
            if _local(m) != "measure" or m.get("number") != "1":
                continue
            return any(_local(el) == "backup" for el in m)
    return False


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(ROOT / "omr-work-bf4e4741.zip") as z:
        z.extract("review.mxl", OUT)
    work = OUT / "fixed.mxl"
    shutil.copy(OUT / "review.mxl", work)
    assert staff2_onset(OUT / "review.mxl") != 0, "fixture: review m1 PL should be delayed"
    assert not has_backup_m1(OUT / "review.mxl")
    fix_mxl_file(work, work)
    onset = staff2_onset(work)
    assert onset == 0, f"PL onset after fix={onset}, want 0"
    assert has_backup_m1(work), "backup required"
    print("ok m1 PL onset", onset)


if __name__ == "__main__":
    main()
