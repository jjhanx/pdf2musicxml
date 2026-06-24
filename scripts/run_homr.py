#!/usr/bin/env python3
"""homr CLI 래퍼 — venv/bin/homr 스크립트가 없을 때 사용.

Usage:
  python scripts/run_homr.py --init
  python scripts/run_homr.py page.png
"""
from __future__ import annotations

import sys


def main() -> None:
    from homr.main import main as homr_main

    # homr.main 은 sys.argv[1]을 이미지 경로로 기대함. insert(0) 하면 run_homr.py 경로가
    # positional image 로 들어가 page_001.png 가 "unrecognized arguments" 가 됨.
    if sys.argv and sys.argv[0].endswith(("run_homr.py", "run_homr")):
        sys.argv[0] = "homr"
    homr_main()


if __name__ == "__main__":
    main()
