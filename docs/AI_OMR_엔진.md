# AI OMR 엔진 (기본 OMR)

**기본 OMR 엔진**입니다. 기존 파이프라인의 **80%**(폰트 분리·clean_score·가사 병합·검증·후처리)는 유지하고, Audiveris 대신 `ai_engine/`으로 악보 인식합니다.

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
| `tr_omr_engine.py` | TrOMR-large (`AI_OMR_BACKEND=tromr`, 기본) |
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
| **`OMR_ENGINE`** | **`ai`** | AI OMR(기본). `audiveris`=레거시 |
| **`AI_OMR_BACKEND`** | **`tromr`** | TrOMR(기본). `mock`=개발용 더미 |
| `AI_OMR_MODEL` | `sanderwood/tr-omr-large` | HuggingFace 모델 ID |
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
