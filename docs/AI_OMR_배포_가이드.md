# AI OMR 배포 가이드 (Local PC · Ubuntu Server)

기존 **폰트 분리 → clean_score → 가사 병합 → 검증 → 후처리**는 그대로 두고, **OMR 단계만** AI로 바꿉니다.

## 파이프라인 요약

```
PDF → pdf_separator → clean_score_only.pdf
                   ↓
              OMR_ENGINE=ai
                   ↓
         ai_engine (TrOMR)
                   ↓
            SymbolGraph → MusicXML
                   ↓
    normalize_omr_rests + fix_audiveris_mxl
                   ↓
            inject_ocr (가사)
                   ↓
         mxl-lint / HITL / verify_*.py
```

상세 모듈 설명: [AI_OMR_엔진.md](AI_OMR_엔진.md)

---

## 1. Local PC (Windows) — 개발·테스트

### 1-1. 공통 (Audiveris / AI 공용)

```powershell
cd D:\pdf2musicxml
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
npm install
npm run build
```

### 1-2. AI OMR (homr, 기본)

```powershell
pip install -r requirements-ai.txt
homr --init
$env:OMR_ENGINE = "ai"
$env:AUDIVERIS_MXL_RHYTHM_FIX = "off"
npm run start:server
```

- `aiOmrBackend`: `"homr"`

### 1-3. CLI 단독 테스트

```powershell
python scripts/run_ai_omr.py clean_score_only.pdf .\test-out\
python scripts/run_full_ai_pipeline.py clean_score_only.pdf .\test-session\
```

### 1-4. Audiveris 레거시 전환

| 목적 | 설정 |
|------|------|
| **기본 (AI OMR)** | `OMR_ENGINE` 미설정 또는 `OMR_ENGINE=ai` |
| Audiveris (레거시) | `OMR_ENGINE=audiveris` + `AUDIVERIS_BIN` |

---

## 2. Ubuntu Server — 운영 배포

### 2-1. 저장소·Python·Node

```bash
cd /opt/pdf2musicxml   # 또는 ~/pdf2musicxml
git pull origin main
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install -r requirements-ai.txt
homr --init
npm ci
npm run build
```

**기존 venv에 `paddlepaddle`/`paddleocr`가 있으면** homr(`numpy>=2.2.6`)과 충돌합니다. 한 번 정리한 뒤 위 명령을 다시 실행하세요.

```bash
pip uninstall -y paddlepaddle paddleocr paddlex 2>/dev/null || true
pip install -r requirements.txt
pip install -r requirements-ai.txt
homr --init
```

- 이미지 PDF OCR은 **PaddleOCR 대신 RapidOCR**(한국어 PP-OCRv5, `numpy` 2.x 호환)을 씁니다.
- 벡터 PDF(대부분의 악보)는 여전히 **PyMuPDF** 직접 추출이 우선입니다.

### 2-2-B. pm2 ecosystem 예시

저장소 루트 [`ecosystem.config.cjs.example`](../ecosystem.config.cjs.example) 참고.

```javascript
env: {
  OMR_ENGINE: 'ai',
  AI_OMR_BACKEND: 'homr',
  // homr: AI_OMR_MODEL 불필요 — 아래 줄은 삭제하거나 주석 처리
  // AI_OMR_MODEL: 'sanderwood/tr-omr-large',  // tromr 전용, homr 와 함께 두지 않음
  PYTHON_BIN: '/mnt/jj/pdf2musicxml/venv/bin/python',
  AUDIVERIS_MXL_RHYTHM_FIX: 'off',
}
```

변경 후 반드시 env 재적용:

```bash
pm2 restart pdf2mxl --update-env
# 또는
pm2 delete pdf2mxl && pm2 start ecosystem.config.cjs
pm2 save
curl -s http://127.0.0.1:8787/api/health | jq '.aiOmrBackend, .aiOmrDepsOk'
# "homr", true
```

`/etc/environment` 등에 **`AI_OMR_BACKEND=tromr`** 이 남아 있으면 ecosystem 설정보다 우선될 수 있습니다. `pm2 env pdf2mxl | grep AI_OMR` 로 실제 값을 확인하세요.

### 2-2-A. AI OMR 전용 서버 (Audiveris 불필요)

`/etc/environment` 또는 pm2 `ecosystem.config.cjs`:

```bash
export OMR_ENGINE=ai
export AI_OMR_BACKEND=homr
export AUDIVERIS_MXL_RHYTHM_FIX=off
export PORT=8787
export PYTHON_BIN=/opt/pdf2musicxml/venv/bin/python
```

GPU 서버(NVIDIA):

```bash
# CUDA PyTorch — https://pytorch.org 에서 환경에 맞는 wheel
pip install torch --index-url https://download.pytorch.org/whl/cu124
pip install transformers Pillow
```

### 2-2-B. Audiveris 레거시 (선택)

Audiveris를 쓸 때만:

```bash
export OMR_ENGINE=audiveris
export AUDIVERIS_BIN=/opt/audiveris/bin/Audiveris
```

### 2-3. pm2 재시작

```bash
pm2 restart pdf2mxl --update-env
pm2 logs pdf2mxl --lines 50
curl -s http://127.0.0.1:8787/api/health | jq .
```

확인 필드:

| 필드 | 기대값 (AI) |
|------|-------------|
| `omrEngine` | `"ai"` |
| `omrEngineReady` | `true` |
| `aiOmrBackend` | `"homr"` |
| `aiOmrDepsOk` | `true` |
| `fontSeparatorDepsOk` | `true` (폰트 분리 파이프라인) |

### 2-4. libqpdf (폰트 분리)

```bash
sudo apt-get install -y libqpdf-dev poppler-utils
pip install pikepdf pdfplumber
```

---

## 3. 환경 변수 전체표

| 변수 | 기본 | 설명 |
|------|------|------|
| **`OMR_ENGINE`** | **`ai`** | AI OMR(기본). `audiveris`=레거시 |
| `AI_OMR_BACKEND` | **`homr`** | homr(기본). `tromr`=HF TrOCR |
| `AI_OMR_MODEL` | **homr 에서 불필요** | `tromr` 전용 — HuggingFace TrOCR 체크포인트 |
| `AI_OMR_DPI` | `300` | PDF 렌더 해상도 |
| `AI_OMR_SYSTEMS_MODE` | `auto` | `auto` \| `single` \| `fixed` |
| `AI_OMR_SYSTEMS_PER_PAGE` | `4` | `fixed` 모드 시 시스템 수 |
| `AI_OMR_SPLIT_STAVES` | `1` | staff별 크롭·인식 |
| `AI_OMR_STAVES_PER_SYSTEM` | `6` | SATB+피아노 |
| `AI_OMR_SAVE_SYMBOL_GRAPH` | `1` | `*.symbol_graph.json` 저장 |
| `AUDIVERIS_MXL_RHYTHM_FIX` | `off` | 리듬 자동 추정 금지 |

`.env.example` 참고.

---

## 4. 품질·검증 (기존 도구 재사용)

AI OMR 출력 MXL은 Audiveris와 **동일 후처리**를 거칩니다.

```bash
python scripts/mxl_quality_lint.py audiveris-out/score.mxl --measure-offset 1
python scripts/fix_audiveris_mxl.py score.mxl score_fixed.mxl
python _smoke/verify_10373611_omr.py   # 회귀 (Audiveris 샘플)
python _smoke/test_ai_engine.py        # SymbolGraph 단위
```

HITL(OMR 품질 검토) UI는 MXL 입력이므로 **엔진 변경 없이** 그대로 사용합니다.

---

## 5. 문제 해결

| 증상 | 조치 |
|------|------|
| `503 AUDIVERIS_BIN` | 레거시 Audiveris 사용 시 `AUDIVERIS_BIN` 설정. 기본 AI OMR이면 `pip install -r requirements.txt` 후 재시작 |
| `aiOmrDepsOk: false` | `pip install -r requirements.txt` + `requirements-ai.txt` + `homr --init` |
| `pip` numpy/paddle 충돌 | `pip uninstall -y paddlepaddle paddleocr paddlex` 후 `requirements.txt`·`requirements-ai.txt` 재설치 (PaddleOCR는 제거됨) |
| homr CLI 없음 / `homr CLI not found` | venv에서 `pip install -r requirements-ai.txt` 후 `python -c "import homr"`. init: `homr --init` 또는 `python scripts/run_homr.py --init` |
| homr 첫 실행 느림 | `homr --init`으로 모델 선다운로드. 페이지마다 homr 1회 실행 |
| TrOMR OOM | `AI_OMR_DPI=200`, GPU 메모리 확인 |
| TrOMR 실패 / `AI_OMR_BACKEND=tromr` | **`AI_OMR_BACKEND=homr`** 로 바꾸고 **`AI_OMR_MODEL` 삭제**. `pm2 restart pdf2mxl --update-env` 후 `/api/health`의 `aiOmrBackend`가 `"homr"`인지 확인 |
| 가사 없음 | 폰트 분리·`inject_ocr` 경로 확인 (AI OMR과 무관) |

---

## 6. 로드맵 (미구현·개선 예정)

- GATv2 voice assigner
- TrOMR 체크포인트 공식 연동·fine-tune
- system_splitter 학습 모델
- UI에서 OMR 엔진 선택 (현재는 서버 env)
