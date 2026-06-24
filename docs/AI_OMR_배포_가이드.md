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

### 1-2. AI OMR (TrOMR, 기본)

```powershell
pip install -r requirements-ai.txt
$env:OMR_ENGINE = "ai"
$env:AI_OMR_MODEL = "sanderwood/tr-omr-large"   # 사용 가능한 HF 체크포인트로 변경
$env:AI_OMR_DPI = "300"
$env:AUDIVERIS_MXL_RHYTHM_FIX = "off"
npm run start:server
```

브라우저 → `http://localhost:8787` → `GET /api/health` 에서:

- `omrEngine`: `"ai"`
- `omrEngineReady`: `true`
- `aiOmrBackend`: `"tromr"`
- `aiOmrDepsOk`: `true`

**CUDA GPU**가 있으면 PyTorch가 자동으로 GPU를 사용합니다 (`aiOmrCudaAvailable: true`).

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
npm ci
npm run build
```

### 2-2-A. AI OMR 전용 서버 (Audiveris 불필요)

`/etc/environment` 또는 pm2 `ecosystem.config.cjs`:

```bash
export OMR_ENGINE=ai
export AI_OMR_BACKEND=tromr
export AI_OMR_MODEL=sanderwood/tr-omr-large
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
| `aiOmrBackend` | `"tromr"` |
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
| `AI_OMR_BACKEND` | **`tromr`** | TrOMR(기본). `mock`=개발용 |
| `AI_OMR_MODEL` | `sanderwood/tr-omr-large` | HuggingFace 모델 ID |
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
| `aiOmrDepsOk: false` | `pip install -r requirements.txt` (+ `requirements-ai.txt`) |
| TrOMR OOM | `AI_OMR_DPI=200`, GPU 메모리 확인 |
| TrOMR 실패 | `pm2 logs`에서 `TrOMR inference failed` 확인. `pip install -r requirements-ai.txt`, 모델 ID·GPU 메모리 |
| 가사 없음 | 폰트 분리·`inject_ocr` 경로 확인 (AI OMR과 무관) |

---

## 6. 로드맵 (미구현·개선 예정)

- GATv2 voice assigner
- TrOMR 체크포인트 공식 연동·fine-tune
- system_splitter 학습 모델
- UI에서 OMR 엔진 선택 (현재는 서버 env)
