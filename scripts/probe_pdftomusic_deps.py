#!/usr/bin/env python3
"""PDFtoMusic Pro(p2mp) 설치·실행 가능 여부 — GET /api/health."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys


def _resolve_p2mp() -> str | None:
    env = (os.environ.get("P2MP_BIN") or "").strip()
    if env and os.path.isfile(env):
        return env
    found = shutil.which("p2mp") or shutil.which("p2mp.exe")
    if found:
        return found
    defaults = []
    if sys.platform == "win32":
        defaults = [
            r"C:\Program Files\PDFtoMusic Pro\p2mp.exe",
            r"C:\Program Files (x86)\PDFtoMusic Pro\p2mp.exe",
        ]
    elif sys.platform == "darwin":
        defaults = ["/Applications/p2mp", "/usr/local/bin/p2mp"]
    else:
        defaults = ["/usr/bin/p2mp", "/usr/local/bin/p2mp"]
    for p in defaults:
        if os.path.isfile(p):
            return p
    return None


def main() -> int:
    p2mp = _resolve_p2mp()
    ok = False
    probe_error: str | None = None
    if p2mp:
        try:
            proc = subprocess.run(
                [p2mp, "-h"],
                capture_output=True,
                text=True,
                timeout=60,
            )
            combined = (proc.stdout or "") + (proc.stderr or "")
            ok = "format" in combined.lower() or proc.returncode == 0
            if not ok:
                probe_error = f"p2mp -h exit {proc.returncode}"
        except Exception as exc:
            probe_error = str(exc)
    hint = None
    if not ok:
        hint = (
            "PDFtoMusic Pro 설치 후 P2MP_BIN 설정 "
            "(Linux: /usr/bin/p2mp, Windows: PDFtoMusic Pro\\p2mp.exe). "
            "벡터 PDF 전용."
        )
    out = {
        "ok": ok,
        "p2mpBin": p2mp,
        "executable": sys.executable,
        "hint": hint,
        "probeError": probe_error,
    }
    print(json.dumps(out, ensure_ascii=False))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
