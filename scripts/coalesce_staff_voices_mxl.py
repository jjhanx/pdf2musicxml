#!/usr/bin/env python3
"""MXL 전 악보 — 가짜 병렬 voice 흡수 후 저장. stdout JSON."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from omr_hitl_lib import (  # noqa: E402
    coalesce_spurious_parallel_voices_in_root,
    load_mxl_root,
    normalize_dynamics_in_root,
    normalize_measure_timelines_in_root,
    normalize_multivoice_stems_in_root,
    normalize_play_orders_including_rests_in_root,
    normalize_slurs_in_root,
    normalize_wedges_in_root,
    realign_play_order_column_timelines_in_root,
    repair_octave_shift_stops_before_cross_staff_backup_in_root,
    write_mxl_root,
)


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "mxl path required"}))
        return 2
    mxl_path = Path(sys.argv[1])
    try:
        files, root_path, root = load_mxl_root(mxl_path)
        n = coalesce_spurious_parallel_voices_in_root(root)
        n_rebuild = normalize_measure_timelines_in_root(root)
        n_oshift = repair_octave_shift_stops_before_cross_staff_backup_in_root(root)
        n_stem = normalize_multivoice_stems_in_root(root)
        n_po = normalize_play_orders_including_rests_in_root(root)
        n_dyns = normalize_dynamics_in_root(root)
        n_slurs = normalize_slurs_in_root(root)
        n_wedges = normalize_wedges_in_root(root)
        # timeline rebuild 이후 — 같은 연주순번 column onset을 저장 MXL에 맞춤(재생)
        n_po_align = realign_play_order_column_timelines_in_root(root)
        if (
            n
            or n_rebuild
            or n_oshift
            or n_stem
            or n_po
            or n_dyns
            or n_slurs
            or n_wedges
            or n_po_align
        ):
            write_mxl_root(mxl_path, files, root_path, root)
        print(
            json.dumps(
                {
                    "coalesceVoiceMeasures": max(n, n_rebuild, n_wedges, n_oshift),
                    "multivoiceStemMeasures": n_stem,
                    "playOrderTimelineMeasures": n_po_align,
                    "octaveShiftStopRepaired": n_oshift,
                },
                ensure_ascii=False,
            )
        )
        return 0
    except (OSError, ValueError) as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
