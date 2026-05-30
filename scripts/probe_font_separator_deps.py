#!/usr/bin/env python3
"""font_separator 파이프라인용 Python 모듈 import 가능 여부 (서버 /api/health)."""
import importlib.util
import json
import sys

MODULES = ("pikepdf", "pdfplumber")

missing = [m for m in MODULES if importlib.util.find_spec(m) is None]
print(
    json.dumps(
        {
            "missing": missing,
            "ok": len(missing) == 0,
            "executable": sys.executable,
            "version": sys.version.split()[0],
        },
        ensure_ascii=False,
    )
)
sys.exit(1 if missing else 0)
