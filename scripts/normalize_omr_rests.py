#!/usr/bin/env python3
"""Audiveris MXL의 쉼표 duration 정규화 — 점이 duration에만 반영된 OMR 오류 자동 보정."""
from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path

from omr_hitl_lib import normalize_rest_durations_file


def main() -> int:
    ap = argparse.ArgumentParser(description="쉼표 duration 정규화 (마디 초과분만 보수적으로 축소)")
    ap.add_argument("mxl_path", type=Path)
    args = ap.parse_args()
    try:
        result = normalize_rest_durations_file(args.mxl_path)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (OSError, ValueError, zipfile.BadZipFile) as e:
        print(str(e), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
