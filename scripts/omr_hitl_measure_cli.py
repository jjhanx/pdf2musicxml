#!/usr/bin/env python3
"""MXL 마디 내 음·쉼 목록(JSON) — OMR HITL UI용.

쉼표 연주순번이 빠진 옛 MXL은 조회 시 timeline으로 재배열해 저장한다.
PL 등 가짜 병렬 voice(underfull primary + full parallel + onset-0 짧은 voice)도
조회 시 primary로 흡수·gap 쉼표 보강 후 저장한다.

전 악보 wedge/dynamics/slur 정규화는 하지 않는다 — 다른 마디 crescendo stop 등을
열기만으로 지우지 않기 위함. 정규화는 연 마디(+그 마디 전용)에만 한정한다.
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
    normalize_measure_timelines_in_root,
    rebuild_measure_timeline_clean,
    write_mxl_root,
    _ns,
)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("mxl_path", type=Path)
    ap.add_argument("--part-id", required=True)
    ap.add_argument("--measure", required=True)
    ap.add_argument(
        "--read-only",
        action="store_true",
        help="정규화·MXL 저장 없이 스냅샷만 (이웃 마디 조회)",
    )
    args = ap.parse_args()
    try:
        files, root_path, root = load_mxl_root(args.mxl_path)
        ns = _ns(root)
        coalesce_fixed = 0
        chord_dupes = 0
        dyns_fixed = 0
        timeline_fixed = 0
        if not args.read_only:
            scope = {(str(args.part_id).strip(), str(args.measure).strip())}
            # 연 마디만 — 전 악보 wedge/slur/articulation normalize 금지
            coalesce_fixed = coalesce_spurious_parallel_voices_in_root(
                root, only_measures=scope
            )
            chord_dupes = dedupe_identical_chord_pitches_in_root(
                root, only_measures=scope
            )
            dyns_fixed = normalize_dynamics_in_root(root, only_measures=scope)
            timeline_fixed = normalize_measure_timelines_in_root(
                root, only_measures=scope
            )
            part = find_part(root, ns, args.part_id)
            if part is not None:
                measure = find_measure(part, ns, args.measure)
                if measure is not None:
                    rebuild_measure_timeline_clean(measure, ns, part)
        snap = measure_snapshot(root, ns, args.part_id, args.measure)
        if snap is None:
            print(json.dumps({"error": "part or measure not found"}, ensure_ascii=False))
            return 1
        if (not args.read_only) and (
            coalesce_fixed or chord_dupes or dyns_fixed or timeline_fixed
        ):
            write_mxl_root(args.mxl_path, files, root_path, root)
            if coalesce_fixed:
                snap["coalesceVoiceMeasures"] = coalesce_fixed
            if chord_dupes:
                snap["chordPitchDedupeMeasures"] = chord_dupes
            if dyns_fixed:
                snap["dynamicsNormalizedMeasures"] = dyns_fixed
            if timeline_fixed:
                snap["timelineMeasuresNormalized"] = timeline_fixed
        print(json.dumps(snap, ensure_ascii=False))
        return 0
    except (OSError, ValueError) as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        return 2
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
