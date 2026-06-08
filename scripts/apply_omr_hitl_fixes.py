#!/usr/bin/env python3
"""omr_hitl_fixes.json 보정을 MXL에 적용."""
from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path

from omr_hitl_lib import apply_fixes_file, load_fixes_json


def main() -> int:
    ap = argparse.ArgumentParser(description="OMR HITL 보정을 MXL에 적용")
    ap.add_argument("mxl_path", type=Path)
    ap.add_argument("--fixes-json", type=Path, required=True)
    args = ap.parse_args()
    fixes = load_fixes_json(args.fixes_json)
    if not fixes:
        print(json.dumps({"applied": 0, "skipped": 0, "fixCount": 0, "reason": "no_fixes"}))
        return 0
    try:
        result = apply_fixes_file(args.mxl_path, fixes)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (OSError, ValueError, zipfile.BadZipFile) as e:
        print(str(e), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
