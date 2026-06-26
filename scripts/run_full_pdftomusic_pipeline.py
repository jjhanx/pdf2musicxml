#!/usr/bin/env python3
"""PDFtoMusic Pro OMR + 후처리 + (선택) 검증 가사 주입 CLI.

Usage:
  python scripts/run_full_pdftomusic_pipeline.py clean_score_only.pdf session_dir/
  python scripts/run_full_pdftomusic_pipeline.py clean_score_only.pdf session_dir/ --ocr-json lyric_manifest.json
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"


def _resolve_p2mp() -> str | None:
    env = (os.environ.get("P2MP_BIN") or "").strip()
    if env and Path(env).is_file():
        return env
    for name in ("p2mp", "p2mp.exe"):
        found = shutil.which(name)
        if found:
            return found
    return None


def _run(cmd: list[str], env: dict | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, capture_output=True, text=True, env=env, check=False)


def main() -> int:
    ap = argparse.ArgumentParser(description="PDFtoMusic Pro → MXL → postprocess → inject")
    ap.add_argument("pdf", type=Path, help="clean_score_only.pdf 등 벡터 PDF")
    ap.add_argument("session_dir", type=Path, help="작업 폴더")
    ap.add_argument("--skip-post", action="store_true", help="fix/normalize 생략")
    ap.add_argument("--ocr-json", type=Path, default=None, help="inject용 ocr/manifest JSON")
    args = ap.parse_args()

    if not args.pdf.is_file():
        print(json.dumps({"error": f"PDF not found: {args.pdf}"}), file=sys.stderr)
        return 1

    p2mp = _resolve_p2mp()
    if not p2mp:
        print(json.dumps({"error": "p2mp not found — set P2MP_BIN"}), file=sys.stderr)
        return 1

    os.environ.setdefault("OMR_ENGINE", "pdftomusic")
    os.environ.setdefault("AUDIVERIS_MXL_RHYTHM_FIX", "off")

    out_dir = args.session_dir / "audiveris-out"
    out_dir.mkdir(parents=True, exist_ok=True)

    argv = [
        p2mp,
        str(args.pdf.resolve()),
        "-format",
        "MXL",
        "-pathdest",
        str(out_dir.resolve()),
        "-lyrics",
        "0",
        "-multivoices",
        "1",
        "-tuplets",
        "1",
    ]
    reg = (os.environ.get("P2MP_REGISTER") or "").strip()
    if reg:
        argv.extend(["-register", reg])

    print(f"Running: {' '.join(argv)}", file=sys.stderr)
    proc = _run(argv)
    if proc.stdout:
        print(proc.stdout, file=sys.stderr)
    if proc.stderr:
        print(proc.stderr, file=sys.stderr)
    if proc.returncode != 0:
        print(json.dumps({"error": f"p2mp failed exit {proc.returncode}"}), file=sys.stderr)
        return proc.returncode

    mxl_paths = sorted(out_dir.glob("*.mxl"))
    if not mxl_paths:
        mxl_paths = sorted(out_dir.glob("*.xml")) + sorted(out_dir.glob("*.musicxml"))
    if not mxl_paths:
        beside = sorted(args.pdf.parent.glob("*.mxl"))
        mxl_paths = beside

    if not mxl_paths:
        print(json.dumps({"error": "no MXL/XML output from p2mp"}), file=sys.stderr)
        return 1

    mxl = mxl_paths[0]
    raw_backup = args.session_dir / "audiveris_raw.mxl"
    if not raw_backup.exists():
        shutil.copy2(mxl, raw_backup)

    if not args.skip_post:
        env = {**os.environ, "AUDIVERIS_MXL_RHYTHM_FIX": "off"}
        for script in ("normalize_omr_rests.py", "fix_audiveris_mxl.py"):
            p = _run([sys.executable, str(SCRIPTS / script), str(mxl)], env=env)
            if p.returncode != 0:
                print(p.stderr or p.stdout, file=sys.stderr)
                return p.returncode

    ocr_json = args.ocr_json
    if ocr_json is None:
        for candidate in (
            args.session_dir / "lyric_manifest.json",
            args.session_dir / "ocr_data.json",
        ):
            if candidate.is_file():
                ocr_json = candidate
                break

    if ocr_json and ocr_json.is_file():
        inj = _run(
            [
                sys.executable,
                str(SCRIPTS / "inject_ocr.py"),
                str(mxl),
                str(mxl),
                str(ocr_json),
            ],
            env={**os.environ, "OMR_ENGINE": "pdftomusic"},
        )
        if inj.returncode != 0:
            print(inj.stderr or inj.stdout, file=sys.stderr)
            return inj.returncode

    labels = args.session_dir / "part_labels.json"
    if not labels.is_file():
        preset = args.session_dir / "part_labels_preset.json"
        if preset.is_file():
            labels = preset
    if labels.is_file():
        pl = _run(
            [
                sys.executable,
                str(SCRIPTS / "apply_part_labels.py"),
                str(mxl),
                str(mxl),
                "--part-labels-json",
                str(labels),
            ]
        )
        if pl.returncode != 0:
            print(pl.stderr or pl.stdout, file=sys.stderr)

    result = {
        "mxlPaths": [str(mxl.resolve())],
        "backend": "pdftomusic",
        "ocrJson": str(ocr_json) if ocr_json else None,
    }
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
