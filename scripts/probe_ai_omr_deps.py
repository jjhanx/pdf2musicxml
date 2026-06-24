#!/usr/bin/env python3
"""AI OMR 의존성 프로브 — GET /api/health 용."""
from __future__ import annotations

import json
import os
import sys

BASE_MODULES = [("fitz", "PyMuPDF"), ("lxml", "lxml")]
HOMR_MODULES = [
    ("homr", "homr"),
    ("onnxruntime", "onnxruntime"),
    ("cv2", "opencv-python-headless"),
]
TROMR_MODULES = [("torch", "torch"), ("transformers", "transformers"), ("PIL", "Pillow")]


def main() -> int:
    backend = (os.environ.get("AI_OMR_BACKEND") or "homr").strip().lower()
    if backend not in ("mock", "tromr", "homr"):
        backend = "homr"
    missing: list[str] = []
    for mod, label in BASE_MODULES:
        try:
            __import__(mod)
        except ImportError:
            missing.append(label)

    torch_ok = False
    cuda = False
    if backend == "homr":
        for mod, label in HOMR_MODULES:
            try:
                __import__(mod)
            except ImportError:
                missing.append(label)
    elif backend != "mock":
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
        if backend == "mock":
            hint = "pip install -r requirements.txt"
        elif backend == "homr":
            hint = "pip install -r requirements.txt && pip install -r requirements-ai.txt && homr --init"
        else:
            hint = "pip install -r requirements.txt && pip install -r requirements-ai.txt"

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
