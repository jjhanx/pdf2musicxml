"""pdf_separator analyze must emit valid JSON even with non-ASCII sample glyphs."""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "pdf_separator.py"
VENV_PY = ROOT / "venv" / "Scripts" / "python.exe"
if not VENV_PY.exists():
    VENV_PY = ROOT / "venv" / "bin" / "python"
PY = str(VENV_PY if VENV_PY.exists() else sys.executable)


def main() -> None:
    pages = [
        {
            "page_number": 1,
            "width": 100,
            "height": 100,
            "text_elements": [
                {"size": 12.0, "raw_text": "가사©", "fontname": "Test"},
                {"size": 12.0, "raw_text": "가", "fontname": "Test"},
            ],
        }
    ]
    with tempfile.TemporaryDirectory() as td:
        extracted = Path(td) / "extracted.json"
        extracted.write_text(json.dumps(pages, ensure_ascii=False), encoding="utf-8")
        env = {**dict(**{k: v for k, v in __import__("os").environ.items()}), "PYTHONUTF8": "1"}
        # Force a narrow encoding like Windows cp949 to ensure fallback still works
        proc = subprocess.run(
            [PY, str(SCRIPT), "analyze", str(extracted)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            check=False,
        )
        assert proc.returncode == 0, proc.stderr
        raw = proc.stdout.strip()
        start = raw.find("{")
        data = json.loads(raw[start:] if start >= 0 else raw)
        assert data.get("entries"), data
        assert any(float(e["sizePt"]) == 12.0 for e in data["entries"])
    print("ok font_strip_analyze_utf8")


if __name__ == "__main__":
    main()
