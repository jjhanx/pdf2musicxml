# PDFtoMusic Pro 배포 가이드 (선택·개인용)

> **상용 SaaS 자동화에는 사용하지 마세요.** Myriad CLI 약관상 제3자 자동화 시스템에 PDFtoMusic Pro를 쓰는 것은 금지되어 있습니다. **기본 OMR은 Audiveris**(`OMR_ENGINE=audiveris`)입니다. 이 문서는 로컬·개인 테스트용입니다.

기본 OMR 파이프라인은 **Audiveris**입니다. PDFtoMusic Pro를 쓸 때만 아래를 참고하세요.

```
PDF → pdf_separator → clean_score_only.pdf
  → p2mp (-lyrics 0) → MXL
  → (선택) 성부 라벨 · OMR HITL
  → inject_ocr.py (lyric_manifest.json / ocr_data.json)
  → fix_audiveris_mxl.py · apply_part_labels.py
```

## 요구 사항

- **벡터 PDF** — Finale, Sibelius, MuseScore 등 악보 편집기에서 내보낸 PDF. **스캔/비트맵 PDF는 불가**.
- **PDFtoMusic Pro** 라이선스 (개인·자동화 사용). SaaS 제3자 제공 등은 Myriad 라이선스 확인.
- Python `requirements.txt` (가사 분리·주입용).

## 설치

### Linux

Myriad 설치 패키지 또는 Wine/VM 환경에 따라 `p2mp` 경로가 다릅니다. 일반 예:

```bash
which p2mp
# 또는
export P2MP_BIN=/usr/bin/p2mp
p2mp -h
```

### Windows

```powershell
$env:P2MP_BIN = "C:\Program Files\PDFtoMusic Pro\p2mp.exe"
& $env:P2MP_BIN -h
```

## 환경 변수

| 변수 | 기본 | 설명 |
|------|------|------|
| **`OMR_ENGINE`** | **`pdftomusic`** | `pdftomusic` \| `audiveris`(레거시) \| `ai`(실험) |
| **`P2MP_BIN`** | 자동 탐색 | `p2mp` 실행 파일 전체 경로 |
| `P2MP_REGISTER` | — | (선택) 라이선스 등록 문자열 |
| `AUDIVERIS_MXL_RHYTHM_FIX` | `off` | MXL 후처리 리듬 추정 끔(권장) |

## pm2 예시

```javascript
env: {
  OMR_ENGINE: 'pdftomusic',
  P2MP_BIN: '/usr/bin/p2mp',
  PYTHON_BIN: '/path/to/venv/bin/python',
  AUDIVERIS_MXL_RHYTHM_FIX: 'off',
}
```

`ecosystem.config.cjs.example` 참고.

## 헬스 확인

```bash
curl -sS http://127.0.0.1:8787/api/health | jq .
```

기대:

- `omrEngine`: `"pdftomusic"`
- `omrEngineReady`: `true`
- `pdftomusicConfigured`: `true`
- `pdftomusicBin`: p2mp 경로

프로브 스크립트:

```bash
python scripts/probe_pdftomusic_deps.py
```

## CLI 일괄 파이프라인 (로컬 테스트)

```bash
python scripts/run_full_pdftomusic_pipeline.py clean_score_only.pdf ./session_dir/
python scripts/run_full_pdftomusic_pipeline.py clean_score_only.pdf ./session_dir/ --ocr-json lyric_manifest.json
```

웹 UI와 동일하게 MXL 후처리·가사 주입·성부 라벨까지 한 번에 실행합니다.

## 가사 처리

- p2mp 실행 시 **`-lyrics 0`** — PDFtoMusic 기본 가사 추출을 끕니다.
- 사용자가 검토 UI에서 확정한 **`lyric_manifest.json`** 또는 **`ocr_data.json`** 을 `inject_ocr.py`가 MusicXML `<lyric>`으로 주입합니다.
- 폰트 분리 모드(권장): pdfplumber로 가사만 제거한 `clean_score_only.pdf`를 OMR에 넣습니다.

## 문제 해결

| 증상 | 조치 |
|------|------|
| `503 PDFtoMusic Pro is not ready` | `P2MP_BIN` 설정, `p2mp -h` 실행 확인 |
| `422` MXL 없음 | 입력 PDF가 벡터인지 확인. `clean_score_only.pdf` 사용 |
| 가사 없음 | `lyric_manifest.json` 존재·검토 완료 여부, `inject_ocr.py` 로그 |
| 품질 이슈 | OMR HITL(웹 UI) 또는 MuseScore에서 MXL 교체 |

## 레거시·실험 엔진

- **Audiveris**: `OMR_ENGINE=audiveris` + `AUDIVERIS_BIN`
- **AI OMR (homr)**: `OMR_ENGINE=ai` — [AI_OMR_배포_가이드.md](AI_OMR_배포_가이드.md)
