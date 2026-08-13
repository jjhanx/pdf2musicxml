#!/usr/bin/env python3
"""MXL 마디 내 음·쉼 목록(JSON) — OMR HITL UI용.

쉼표 연주순번이 빠진 옛 MXL은 조회 시 timeline으로 재배열해 저장한다.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from omr_hitl_lib import (  # noqa: E402
    load_mxl_root,
    measure_snapshot,
    normalize_play_orders_including_rests_in_root,
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
        # 전 악보 정규화 — 다른 마디에 남은 옛 순번도 함께 고침
        rest_po_fixed = normalize_play_orders_including_rests_in_root(root)
        snap = measure_snapshot(root, ns, args.part_id, args.measure)
        if snap is None:
            print(json.dumps({"error": "part or measure not found"}, ensure_ascii=False))
            return 1
        if rest_po_fixed:
            write_mxl_root(args.mxl_path, files, root_path, root)
            snap["restPlayOrderMeasuresNormalized"] = rest_po_fixed
        print(json.dumps(snap, ensure_ascii=False))
        return 0
    except (OSError, ValueError) as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
