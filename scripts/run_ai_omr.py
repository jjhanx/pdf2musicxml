#!/usr/bin/env python3
"""AI OMR CLI — Node 서버·로컬 테스트용.

Usage:
  python scripts/run_ai_omr.py clean_score_only.pdf /path/to/audiveris-out/
stdout: JSON (mxlPaths, symbolGraphPath, backend, …)
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ai_engine.config import load_config
from ai_engine.pipeline import run_ai_omr_pipeline


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    ap = argparse.ArgumentParser(description="AI OMR → SymbolGraph → MusicXML")
    ap.add_argument("pdf", type=Path, help="입력 PDF (clean_score_only.pdf 권장)")
    ap.add_argument("output_dir", type=Path, help="MXL 출력 디렉터리")
    ap.add_argument("--basename", default=None, help="출력 파일 basename (기본 score)")
    args = ap.parse_args()

    if not args.pdf.is_file():
        print(json.dumps({"error": f"PDF not found: {args.pdf}"}), file=sys.stderr)
        return 1

    cfg = load_config()
    if args.basename:
        cfg.output_basename = args.basename

    try:
        result = run_ai_omr_pipeline(args.pdf, args.output_dir, cfg)
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 1

    out = {
        "mxlPaths": result.mxl_paths,
        "symbolGraphPath": result.symbol_graph_path,
        "backend": result.backend,
        "measureCount": result.measure_count,
        "nodeCount": result.node_count,
        "stats": result.stats,
    }
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
