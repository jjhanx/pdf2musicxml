#!/usr/bin/env bash
# 폰트 분리 파이프라인용 Python 패키지 (pdfplumber, pikepdf) 설치
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -x "$ROOT/venv/bin/python" ]]; then
  PY="$ROOT/venv/bin/python"
elif [[ -x "$ROOT/.venv/bin/python" ]]; then
  PY="$ROOT/.venv/bin/python"
elif [[ -n "${PYTHON_BIN:-}" ]]; then
  PY="$PYTHON_BIN"
else
  echo "venv를 찾을 수 없습니다. venv/bin/python 또는 PYTHON_BIN을 설정하세요." >&2
  exit 1
fi

echo "Using: $PY"
"$PY" -m pip install --upgrade pip
"$PY" -m pip install pdfplumber pikepdf

echo ""
echo "Verify:"
"$PY" -c "import pdfplumber, pikepdf; print('OK: pdfplumber', pdfplumber.__version__, 'pikepdf', pikepdf.__version__)"

echo ""
echo "Node 서버(PM2 등)를 재시작한 뒤 확인:"
echo "  curl -s http://127.0.0.1:8787/api/health | python3 -m json.tool | grep fontSeparator"
echo ""
echo "fontSeparatorPythonBin 이 위 venv 와 다르면 PM2에 PYTHON_BIN 을 설정하세요:"
echo "  export PYTHON_BIN=$PY"
