# AI OMR 엔진 (실험)

> **기본 OMR은 Audiveris**입니다. `OMR_ENGINE=ai`일 때만 이 모듈이 사용됩니다.

기존 파이프라인의 **80%**(폰트 분리·clean_score·가사 병합·검증·후처리)는 유지하고, OMR 단계만 `ai_engine/`으로 대체합니다.

**배포 절차(Windows·Ubuntu):** [AI_OMR_배포_가이드.md](AI_OMR_배포_가이드.md)

## 파이프라인

```
PDF → 폰트분리 → clean_score_only.pdf
              ↓
         OMR_ENGINE=ai
              ↓
    image_loader → system_splitter → staff_splitter
              ↓
         TrOMR (tromr)
              ↓
         semantic_decoder → SymbolGraph
              ↓
         voice_assigner → rhythm_corrector (off)
              ↓
         musicxml_builder → .mxl
              ↓
    normalize_omr_rests + fix_audiveris_mxl (기존)
              ↓
         inject_ocr (가사, 기존)
              ↓
    mxl-lint / verify_*.py / HITL (기존)
```

## 디렉터리

| 모듈 | 역할 |
|------|------|
| `config.py` | SATB+피아노 6 staff 레이아웃, env |
| `image_loader.py` | PDF → 페이지 RGB (PyMuPDF) |
| `system_splitter.py` | 페이지 → 시스템(마디 줄) — **수평 잉크 투영** |
| `staff_splitter.py` | 시스템 → 6 staff 크롭 |
| `homr_pipeline.py` | homr 페이지 OMR → MXL 병합 (기본) |
| `tr_omr_engine.py` | HF TrOCR (`AI_OMR_BACKEND=tromr`) |
| `semantic_decoder.py` | `staff0-note-C5-quarter` → SymbolNode |
| `symbol_graph.py` | Audiveris XML 대체 내부 표현 |
| `voice_assigner.py` | 규칙 기반 voice (후속 GATv2) |
| `rhythm_corrector.py` | pass-through (추정 없음) |
| `musicxml_builder.py` | SymbolGraph → `.mxl` |
| `pipeline.py` | end-to-end |

## CLI

```bash
# AI OMR만
python scripts/run_ai_omr.py clean_score_only.pdf ./test-out/

# AI OMR + 후처리 + (선택) inject
python scripts/run_full_ai_pipeline.py clean_score_only.pdf ./session/ --ocr-json lyric_manifest.json

# 의존성 확인
python scripts/probe_ai_omr_deps.py
```

## 환경 변수

| 변수 | 기본 | 설명 |
|------|------|------|
| **`OMR_ENGINE`** | **`audiveris`(기본)** | AI OMR은 `OMR_ENGINE=ai` |
| **`AI_OMR_BACKEND`** | **`homr`** | homr(기본). `tromr`=HF TrOCR |
| `AI_OMR_MODEL` | (tromr만) | HuggingFace TrOCR 체크포인트 |
| `AI_OMR_DPI` | `300` | PDF 렌더 DPI |
| `AI_OMR_SYSTEMS_MODE` | `auto` | `auto` \| `single` \| `fixed` |
| `AI_OMR_SYSTEMS_PER_PAGE` | `4` | `fixed` 모드 시 |
| `AI_OMR_SPLIT_STAVES` | `1` | staff별 TrOMR |
| `AI_OMR_STAVES_PER_SYSTEM` | `6` | SATB+피아노 |
| `AI_OMR_SAVE_SYMBOL_GRAPH` | `1` | JSON 디버그 저장 |

`GET /api/health` → `omrEngine`, `omrEngineReady`, `aiOmrDepsOk`, `aiOmrCudaAvailable`

## SymbolGraph

Audiveris MusicXML을 대체하는 중간 표현. `*.symbol_graph.json`으로 저장되며 HITL·검증 확장에 사용합니다.

리듬 자동 추정은 **하지 않습니다** (`rhythm_corrector` off, `AUDIVERIS_MXL_RHYTHM_FIX=off`).

## 로드맵

- GATv2 voice assigner
- TrOMR fine-tune / 공식 체크포인트
- UI OMR 엔진 선택 (현재 서버 env)

## 7. 트러블슈팅 및 일반적 해결책 (General Solutions)

### Windows 환경에서 Python 인코딩(UnicodeDecodeError) 오류 방지
- **문제**: `homr` 백엔드 등에서 `musicxml` 라이브러리가 XML을 로드할 때, Windows의 기본 인코딩(`cp949`)을 사용하여 파싱하다가 `UnicodeDecodeError`가 발생할 수 있습니다.
- **일반적 해결책**: Node.js 서버(`server/index.ts`) 및 `shared/omr.ts`에서 Python 서브프로세스를 생성할 때 `PYTHONUTF8='1'` 환경 변수를 강제 주입하여, 모든 Python 파일 I/O가 `utf-8`을 기본값으로 사용하도록 보장합니다.

### OMR 엔진 로그 디버깅
- **문제**: OMR 엔진(`homr`, `tromr`, `Audiveris` 등)이 백그라운드에서 실패했을 때 에러 원인을 추적하기 어렵습니다.
- **일반적 해결책**: `server/index.ts`에서 OMR 엔진 실행 후 `stdout`과 `stderr`를 `omr_engine.log` 파일로 세션 디렉토리에 저장합니다. 사용자는 UI에서 '디버그 ZIP 다운로드'를 클릭하여 해당 로그 파일을 직접 확인할 수 있으며, 실패 시 에러 메시지에도 이 로그를 확인하도록 안내합니다.

### UI 내 활성 OMR 엔진 표시
- **문제**: OMR 품질 검토(HITL) 단계에 진입했을 때, 현재 페이지가 어떤 OMR 엔진으로 변환된 결과인지 식별하기 어렵습니다.
- **일반적 해결책**: API 렌더링 시 `activeOmrEngine` 상태를 `summary` 엔드포인트 응답에 추가하고, `OmrStaffReviewPanel` 컴포넌트 헤더에 뱃지(예: `AI OMR`, `PDFtoMusic Pro`, `Audiveris`)를 띄워 변환 출처를 명확히 안내합니다.

### OpenCV resize 시 크기 0에 의한 크래시 방지
- **문제**: `homr` 파이프라인에서 여백(margin)이나 스태프 영역이 아주 작게 인식될 경우, 캔버스 크기를 리사이징하는 계산 결과가 0 차원(`width`나 `height`가 0)으로 떨어질 수 있습니다. 이 상태로 `cv2.resize`를 호출하면 `error: (-215:Assertion failed) inv_scale_x > 0` 등의 에러가 발생하며 파이프라인이 즉시 중단됩니다.
- **일반적 해결책**: `scripts/run_homr.py`에서 `homr` 패키지를 로드하기 전에 전역적으로 `cv2.resize`를 몽키패치하여 전달받는 목표 크기(`dsize`)가 항상 최소 `(1, 1)` 이상이 되도록 보장합니다.
