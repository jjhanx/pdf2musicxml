#!/usr/bin/env python3
"""MXL — 명시 연주순번 column onset을 저장 타임라인에 맞춤. stdout JSON."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from omr_hitl_lib import (  # noqa: E402
    load_mxl_root,
    realign_play_order_column_timelines_in_root,
    write_mxl_root,
)


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "mxl path required"}))
        return 2
    mxl_path = Path(sys.argv[1])
    try:
        files, root_path, root = load_mxl_root(mxl_path)
        n = realign_play_order_column_timelines_in_root(root)
        if n:
            write_mxl_root(mxl_path, files, root_path, root)
        print(json.dumps({"playOrderTimelineMeasures": n}, ensure_ascii=False))
        return 0
    except (OSError, ValueError) as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
