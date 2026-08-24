#!/usr/bin/env python3
"""MXL 마디 내 음·쉼 목록(JSON) — OMR HITL UI용.

쉼표 연주순번이 빠진 옛 MXL은 조회 시 timeline으로 재배열해 저장한다.
PL 등 가짜 병렬 voice(underfull primary + full parallel + onset-0 짧은 voice)도
조회 시 primary로 흡수·gap 쉼표 보강 후 저장한다.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from omr_hitl_lib import (  # noqa: E402
    coalesce_spurious_parallel_voices_in_root,
    dedupe_identical_chord_pitches_in_root,
    find_measure,
    find_part,
    load_mxl_root,
    measure_snapshot,
    normalize_dynamics_in_root,
    normalize_play_orders_including_rests_in_root,
    normalize_slurs_in_root,
    normalize_articulations_in_root,
    normalize_wedges_in_root,
    rebuild_measure_timeline_clean,
    write_mxl_root,
    _ns,
)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("mxl_path", type=Path)
    ap.add_argument("--part-id", required=True)
    ap.add_argument("--measure", required=True)
    args = ap.parse_args()
    try:
        files, root_path, root = load_mxl_root(args.mxl_path)
        ns = _ns(root)
        # 전 악보 정규화 — 다른 마디에 남은 옛 순번 및 이음줄도 함께 고침
        rest_po_fixed = normalize_play_orders_including_rests_in_root(root)
        coalesce_fixed = coalesce_spurious_parallel_voices_in_root(root)
        chord_dupes = dedupe_identical_chord_pitches_in_root(root)
        dyns_fixed = normalize_dynamics_in_root(root)
        slurs_fixed = normalize_slurs_in_root(root)
        arts_fixed = normalize_articulations_in_root(root)
        wedges_fixed = normalize_wedges_in_root(root)
        part = find_part(root, ns, args.part_id)
        if part is not None:
            measure = find_measure(part, ns, args.measure)
            if measure is not None:
                rebuild_measure_timeline_clean(measure, ns, part)
        snap = measure_snapshot(root, ns, args.part_id, args.measure)
        if snap is None:
            print(json.dumps({"error": "part or measure not found"}, ensure_ascii=False))
            return 1
        if rest_po_fixed or coalesce_fixed or chord_dupes or dyns_fixed or slurs_fixed or arts_fixed or wedges_fixed:
            write_mxl_root(args.mxl_path, files, root_path, root)
            if rest_po_fixed:
                snap["restPlayOrderMeasuresNormalized"] = rest_po_fixed
            if coalesce_fixed:
                snap["coalesceVoiceMeasures"] = coalesce_fixed
            if chord_dupes:
                snap["chordPitchDedupeMeasures"] = chord_dupes
            if slurs_fixed:
                snap["slursNormalizedMeasures"] = slurs_fixed
            if arts_fixed:
                snap["articulationsNormalizedNotes"] = arts_fixed
            if wedges_fixed:
                snap["wedgesNormalizedMeasures"] = wedges_fixed
        print(json.dumps(snap, ensure_ascii=False))
        return 0
    except (OSError, ValueError) as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
