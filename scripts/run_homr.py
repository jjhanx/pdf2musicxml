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

    if not sys.argv or sys.argv[0].endswith("run_homr.py"):
        sys.argv.insert(0, "homr")
    homr_main()


if __name__ == "__main__":
    main()
