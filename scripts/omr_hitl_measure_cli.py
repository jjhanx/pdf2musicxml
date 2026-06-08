#!/usr/bin/env python3
"""MXL 마디 내 음·쉼 목록(JSON) — OMR HITL UI용."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from omr_hitl_lib import load_mxl_root, measure_snapshot, _ns


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("mxl_path", type=Path)
    ap.add_argument("--part-id", required=True)
    ap.add_argument("--measure", required=True)
    args = ap.parse_args()
    try:
        _files, _root_path, root = load_mxl_root(args.mxl_path)
        ns = _ns(root)
        snap = measure_snapshot(root, ns, args.part_id, args.measure)
        if snap is None:
            print(json.dumps({"error": "part or measure not found"}, ensure_ascii=False))
            return 1
        print(json.dumps(snap, ensure_ascii=False))
        return 0
    except (OSError, ValueError) as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
