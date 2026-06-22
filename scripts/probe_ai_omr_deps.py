#!/usr/bin/env python3
"""AI OMR 의존성 프로브 — GET /api/health 용."""
from __future__ import annotations

import json
import os
import sys

BASE_MODULES = [("fitz", "PyMuPDF"), ("lxml", "lxml")]
TROMR_MODULES = [("torch", "torch"), ("transformers", "transformers"), ("PIL", "Pillow")]


def main() -> int:
    backend = (os.environ.get("AI_OMR_BACKEND") or "mock").strip().lower()
    missing: list[str] = []
    for mod, label in BASE_MODULES:
        try:
            __import__(mod)
        except ImportError:
            missing.append(label)

    torch_ok = False
    cuda = False
    if backend == "tromr":
        for mod, label in TROMR_MODULES:
            try:
                __import__(mod)
            except ImportError:
                missing.append(label)
        try:
            import torch

            torch_ok = True
            cuda = torch.cuda.is_available()
        except ImportError:
            pass

    hint = None
    if missing:
        hint = "pip install -r requirements.txt"
        if backend == "tromr":
            hint += " && pip install -r requirements-ai.txt"

    out = {
        "ok": len(missing) == 0,
        "backend": backend,
        "missing": missing,
        "torchOk": torch_ok,
        "cudaAvailable": cuda,
        "executable": sys.executable,
        "hint": hint,
    }
    print(json.dumps(out, ensure_ascii=False))
    return 0 if out["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
