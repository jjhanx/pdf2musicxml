#!/usr/bin/env python3
"""Prepared MXL(또는 omr-work ZIP) → 대상 MXL 마디 구간 전 파트 복사."""
from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path

from omr_hitl_lib import (
    copy_measure_range_from_omr_work,
    copy_measure_range_from_prepared_mxl,
)


def main() -> int:
    ap = argparse.ArgumentParser(description="마디 구간 → 대상 MXL 전 파트 복사")
    ap.add_argument("dst_mxl", type=Path, help="복사 대상(현재 세션) MXL")
    ap.add_argument("source", type=Path, help="출처 prepared.mxl 또는 omr-work.zip")
    ap.add_argument("--from", dest="src_start", type=int, required=True, help="출처 시작 마디")
    ap.add_argument("--to", dest="src_end", type=int, required=True, help="출처 끝 마디")
    ap.add_argument("--target-start", type=int, default=None, help="대상 시작 마디")
    ap.add_argument(
        "--prepared-source",
        action="store_true",
        help="source가 import-work·sync 완료 MXL (--prepared-source)",
    )
    args = ap.parse_args()
    if not args.dst_mxl.is_file():
        print(f"대상 MXL 없음: {args.dst_mxl}", file=sys.stderr)
        return 2
    if not args.source.is_file():
        print(f"출처 없음: {args.source}", file=sys.stderr)
        return 2
    try:
        if args.prepared_source or args.source.suffix.lower() == ".mxl":
            result = copy_measure_range_from_prepared_mxl(
                args.dst_mxl,
                args.source,
                args.src_start,
                args.src_end,
                args.target_start,
            )
        else:
            result = copy_measure_range_from_omr_work(
                args.dst_mxl,
                args.source,
                args.src_start,
                args.src_end,
                args.target_start,
            )
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result.get("measuresCopied", 0) > 0 else 1
    except (OSError, ValueError, zipfile.BadZipFile) as e:
        print(str(e), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
