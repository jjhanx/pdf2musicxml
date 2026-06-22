#!/usr/bin/env python3
"""AI OMR 전체 파이프라인: PDF → AI OMR → postprocess → (선택) inject.

Usage:
  python scripts/run_full_ai_pipeline.py clean_score_only.pdf session_dir/
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"


def _run(cmd: list[str], env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, env=env, check=False)


def main() -> int:
    ap = argparse.ArgumentParser(description="AI OMR full pipeline smoke / batch")
    ap.add_argument("pdf", type=Path)
    ap.add_argument("session_dir", type=Path, help="작업 폴더 (omr-out, ocr 등)")
    ap.add_argument("--skip-post", action="store_true", help="fix/normalize 생략")
    ap.add_argument("--ocr-json", type=Path, default=None, help="inject용 ocr/manifest")
    args = ap.parse_args()

    os.environ.setdefault("OMR_ENGINE", "ai")
    os.environ.setdefault("AUDIVERIS_MXL_RHYTHM_FIX", "off")

    out_dir = args.session_dir / "audiveris-out"
    out_dir.mkdir(parents=True, exist_ok=True)

    r = _run([sys.executable, str(SCRIPTS / "run_ai_omr.py"), str(args.pdf), str(out_dir)])
    if r.returncode != 0:
        print(r.stderr or r.stdout, file=sys.stderr)
        return r.returncode
    try:
        omr_result = json.loads(r.stdout.strip().splitlines()[-1])
    except json.JSONDecodeError:
        print("run_ai_omr JSON parse failed", file=sys.stderr)
        return 1

    mxl_paths = omr_result.get("mxlPaths") or []
    if not mxl_paths:
        print("no MXL output", file=sys.stderr)
        return 1

    mxl = Path(mxl_paths[0])
    raw_backup = args.session_dir / "audiveris_raw.mxl"
    if not raw_backup.exists():
        import shutil

        shutil.copy2(mxl, raw_backup)

    if not args.skip_post:
        env = {**os.environ, "AUDIVERIS_MXL_RHYTHM_FIX": "off"}
        for script in ("normalize_omr_rests.py", "fix_audiveris_mxl.py"):
            p = _run([sys.executable, str(SCRIPTS / script), str(mxl)], env=env)
            if p.returncode != 0:
                print(p.stderr or p.stdout, file=sys.stderr)
                return p.returncode

        lint = _run(
            [
                sys.executable,
                str(SCRIPTS / "mxl_quality_lint.py"),
                str(mxl),
                "--measure-offset",
                "1",
                "--json",
                str(args.session_dir / "mxl_lint.json"),
            ]
        )
        if lint.returncode != 0:
            print(lint.stderr or lint.stdout, file=sys.stderr)

    if args.ocr_json and args.ocr_json.is_file():
        inject = _run(
            [
                sys.executable,
                str(SCRIPTS / "inject_ocr.py"),
                str(mxl),
                str(args.ocr_json),
                str(mxl),
            ],
            env={**os.environ, "AUDIVERIS_MXL_RHYTHM_FIX": "off"},
        )
        if inject.returncode != 0:
            print(inject.stderr or inject.stdout, file=sys.stderr)
            return inject.returncode

    print(
        json.dumps(
            {"mxl": str(mxl), "symbolGraph": omr_result.get("symbolGraphPath"), "ok": True},
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
