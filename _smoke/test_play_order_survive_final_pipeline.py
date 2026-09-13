#!/usr/bin/env python3
"""fix→coalesce→restructure→realign 후에도 병렬 LH 연주순번 onset·voice 구분 유지."""
from __future__ import annotations

import shutil
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "_smoke" / "_bf4e_po_pipeline"
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import (  # noqa: E402
    _local,
    _note_voice_staff,
    _ns,
    _read_play_order,
    _voice_parallel_note_onsets,
    load_mxl_root,
)


def misalign_and_voices(path: Path, pid: str, mn: str, po: int):
    files, rp, root = load_mxl_root(path)
    ns = _ns(root)
    for part in root:
        if _local(part) != "part" or part.get("id") != pid:
            continue
        for m in part:
            if _local(m) != "measure" or m.get("number") != mn:
                continue
            onsets = _voice_parallel_note_onsets(m, ns)
            rows = []
            voices = set()
            for note, onset in onsets.items():
                v, st = _note_voice_staff(note, ns)
                if st == "2":
                    voices.add(v)
                if _read_play_order(note) == po:
                    rows.append((onset, v))
            return rows, sorted(voices, key=lambda x: int(x) if str(x).isdigit() else 99)
    return [], []


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    import zipfile

    with zipfile.ZipFile(ROOT / "omr-work-bf4e4741.zip") as z:
        z.extract("review.mxl", OUT)
        z.extract("part_labels.json", OUT)

    work = OUT / "final.mxl"
    shutil.copy(OUT / "review.mxl", work)

    from fix_audiveris_mxl import fix_mxl_file
    from restructure_mxl_parts import restructure_mxl

    fix_mxl_file(work, work)
    rows, voices = misalign_and_voices(work, "P5", "24", 2)
    assert len(set(v for _, v in rows)) >= 2, f"fix must keep parallel voices, got {rows} voices={voices}"

    subprocess.check_call(
        [sys.executable, str(ROOT / "scripts" / "coalesce_staff_voices_mxl.py"), str(work)],
        stdout=subprocess.DEVNULL,
    )
    restructure_mxl(work, work, OUT / "part_labels.json")
    subprocess.check_call(
        [sys.executable, str(ROOT / "scripts" / "realign_play_order_timelines_mxl.py"), str(work)],
        stdout=subprocess.DEVNULL,
    )

    rows, voices = misalign_and_voices(work, "P5", "24", 2)
    assert len(rows) >= 2, rows
    assert len({o for o, _ in rows}) == 1, f"po=2 must share onset: {rows}"
    assert len({v for _, v in rows}) >= 2, f"parallel voices required: {rows}"
    print("ok", rows, "staff2 voices", voices)


if __name__ == "__main__":
    main()
