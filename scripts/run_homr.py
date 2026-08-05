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

    # Monkey-patch cv2.resize globally for homr to prevent zero-dimension crashes (inv_scale_x > 0)
    try:
        import cv2
        orig_resize = cv2.resize
        def safe_resize(src, dsize, *args, **kwargs):
            if dsize[0] < 1 or dsize[1] < 1:
                dsize = (max(1, int(dsize[0])), max(1, int(dsize[1])))
            return orig_resize(src, dsize, *args, **kwargs)
        
        import homr.main
        import homr.staff_parsing
        import homr.staff_dewarping
        homr.main.cv2.resize = safe_resize
        homr.staff_parsing.cv2.resize = safe_resize
        homr.staff_dewarping.cv2.resize = safe_resize
    except Exception:
        pass

    # homr.main 은 sys.argv[1]을 이미지 경로로 기대함. insert(0) 하면 run_homr.py 경로가
    # positional image 로 들어가 page_001.png 가 "unrecognized arguments" 가 됨.
    if sys.argv and sys.argv[0].endswith(("run_homr.py", "run_homr")):
        sys.argv[0] = "homr"
    homr_main()


if __name__ == "__main__":
    main()
