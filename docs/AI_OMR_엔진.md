# AI OMR 엔진 (Audiveris 대체)

기존 파이프라인의 **80%**(폰트 분리·clean_score·가사 병합·검증·후처리)는 유지하고, **Audiveris만** `ai_engine/`으로 교체합니다.

## 파이프라인

```
PDF → 폰트분리 → clean_score_only.pdf
              ↓
         AI OMR (TrOMR / mock)
              ↓
         SymbolGraph
              ↓
         Voice Assignment
              ↓
         MusicXML (.mxl)
              ↓
    normalize_omr_rests + fix_audiveris_mxl (기존)
              ↓
         lyrics injection (기존)
              ↓
    verify_*.py / mxl-lint (기존)
```

## 디렉터리

| 모듈 | 역할 |
|------|------|
| `config.py` | SATB+피아노 staff 레이아웃, DPI, backend |
| `image_loader.py` | PDF → 페이지 RGB (PyMuPDF) |
| `system_splitter.py` | 페이지 → 시스템 영역 (1차: 전체 페이지) |
| `tr_omr_engine.py` | TrOMR-large 또는 **mock** 토큰 출력 |
| `semantic_decoder.py` | `note-C5-quarter` → `SymbolNode` |
| `symbol_graph.py` | Audiveris XML 대체 내부 표현 |
| `voice_assigner.py` | 규칙 기반 voice (후속 GATv2) |
| `rhythm_corrector.py` | pass-through (리듬 추정은 MusicXML 후처리/HITL) |
| `musicxml_builder.py` | SymbolGraph → `.mxl` |
| `pipeline.py` | end-to-end |

## 환경 변수

| 변수 | 기본 | 설명 |
|------|------|------|
| **`OMR_ENGINE`** | `audiveris` | `ai` 로 설정 시 AI OMR 사용 |
| `AI_OMR_BACKEND` | `mock` | `mock` \| `tromr` |
| `AI_OMR_MODEL` | `sanderwood/tr-omr-large` | HuggingFace 모델 ID |
| `AI_OMR_DPI` | `300` | PDF 렌더 DPI |
| `AI_OMR_DIVISIONS` | `6` | MusicXML divisions |
| `AI_OMR_SAVE_SYMBOL_GRAPH` | `1` | `*.symbol_graph.json` 저장 |

`OMR_ENGINE=ai` 이면 **`AUDIVERIS_BIN` 없이** 변환 가능 (`GET /api/health` → `omrEngineReady`).

## 로컬 실행

```bash
python scripts/run_ai_omr.py clean_score_only.pdf ./test-out/
# stdout: {"mxlPaths":["..."],"symbolGraphPath":"...","backend":"mock",...}
```

TrOMR (GPU 권장):

```bash
pip install torch transformers Pillow
export AI_OMR_BACKEND=tromr
python scripts/run_ai_omr.py clean_score_only.pdf ./test-out/
```

## 다음 단계

1. **system_splitter** — 오선 수평 투영·학습 모델로 SATB+피아노 6 staff 분할
2. **TrOMR** — 페이지/시스템별 멀티 staff 토큰 (staff prefix)
3. **GATv2 voice assigner** — 규칙 기반 voice 교체
4. **SymbolGraph → 기존 fix/lint** — 입력 어댑터(선택)

리듬 자동 추정은 **하지 않습니다** (`rhythm_corrector` off, `AUDIVERIS_MXL_RHYTHM_FIX=off`).
