#!/usr/bin/env python3
"""MXL 전체에서 chord 멤버 orphan beam 제거 (OSMD 미리보기 호환)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from omr_hitl_lib import cleanup_chord_beams_in_root, load_mxl_root, write_mxl_root


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: cleanup_chord_beams_mxl.py <path.mxl>", file=sys.stderr)
        return 1
    mxl_path = Path(sys.argv[1])
    files, root_path, root = load_mxl_root(mxl_path)
    cleaned = cleanup_chord_beams_in_root(root)
    if cleaned > 0:
        write_mxl_root(mxl_path, files, root_path, root)
    print(json.dumps({"chordBeamMeasuresCleaned": cleaned}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
