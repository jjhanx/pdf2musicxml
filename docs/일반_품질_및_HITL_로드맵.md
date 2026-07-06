# 일반 악보 품질·HITL 로드맵

예제 PDF용 pt/x 하드코딩은 쓰지 않습니다. 품질은 **환경·UI 선택·Audiveris 엔진·MXL lint·사람 검토(HITL)** 로 단계적으로 다룹니다.

## 구현 순서 (권장)

| 단계 | 내용 | 저장소 |
|------|------|--------|
| 1 | **폰트 strip**: UI에서 고른 pt만 제거 (`clean_score_only.pdf`) | `scripts/pdf_separator.py` |
| 2 | **OMR 정책 노출**: OCR `eng`, TextWord 상수, P 유발 경로 | `GET /api/diagnostic/:jobId/omr-policy`, `shared/audiveris.ts` |
| 3 | **MXL lint**: 악보 무관 휴리스틱 (P direction, 마디 끝 쉼표, 마디 경계 순서) | `scripts/mxl_quality_lint.py`, `GET …/mxl-lint` |
| 4a | **성부 라벨 지정**: Audiveris MXL part-list → S/A/T/B/PR/PL 등 (PDF **p.** 와 구분) | `part_labels_needed`, `part_labels.json` |
| 4b | **페이지×staff HITL**: lint → **앱 내 MXL 보정** → 이어하기 | `omr_staff_review_needed`, `omr_hitl_fixes.json`, `apply_omr_hitl_fixes.py` |
| 4c | **(폰트 분리) PyMuPDF 가사 검증·편집** — OMR·HITL **이후**, 원본 PDF 미리보기 | `review_needed`, `reviewAfterOmr`, `ocr_data_pymupdf.json` |
| 5 | (선택) Audiveris 보정·마스킹 점검 | `audiveris_review_needed`, `AudiverisInspectPanel` |
| 6 | (장기) SYMBOLS/BEAMS 단계별 HITL | Audiveris GUI·패치·별도 도구 |

## 사용자가 할 일 (단계별)

### A. 서버·UI 반영 (변경 후마다)

```bash
cd /path/to/pdf2musicxml   # Windows: D:\pdf2musicxml
git pull origin main
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
npm install
npm run build
# 변환·HITL 대기 job이 없을 때만 재시작 (진행 중이면 job이 끊김)
pm2 restart pdf2mxl
```

브라우저에서 **강력 새로고침**(캐시 비우기) 후 변환을 다시 시작합니다. **같은 jobId·옛 `clean_score` PDF를 재사용하지 마세요.**

**완료 여부 확인** (OMR HITL 켜짐 시 한 job이 끝까지 갔는지):

```bash
pm2 logs pdf2mxl --lines 200 --nostream | grep -E "Part labels saved|inject_ocr|apply_part_labels|Completed"
```

정상 완료 흐름 예: `Part labels saved` → `Running inject_ocr.py` → `apply_part_labels: {"applied":true}` → `Completed`. `Pausing for part label setup` 이후 위 로그가 없으면 **성부 라벨 미확정**, **OMR 이어하기 미클릭**, **pm2 재시작·동시 업로드**로 job이 중단된 경우가 많습니다.

`merge_lyric_sources.py`의 `Output:`·`stats` 줄은 **stderr가 아니라 통계**이며 실패가 아닙니다. `mxl_quality_lint.py`의 `AttributeError`(예: 83번 줄)는 **옛 스크립트** — `git pull` 후 재시작하세요.

### B. 1단계 — clean_score 만들 때 (폰트 strip)

1. 변환 시작 → **폰트 크기 선택** UI가 뜨면:
   - **제목·가사**에 해당하는 **큰 pt만** 선택 (예: 20pt대 제목).
   - **음자리표·음표·조표**(보통 ~22.8pt 등)는 **선택하지 않음**.
2. **clean_score_only.pdf 확인** 모달에서 **원본 vs clean_score** PNG를 나란히 보고, **음표 머리·오선**이 남았는지 확인합니다. **「clean_score PDF 저장」**으로 로컬에 남길 수 있습니다.
3. 문제가 있으면 **「폰트 범위 다시 선택」** → 범위를 좁힌 뒤 재생성. 확인 후 **「Audiveris로 계속」**.
4. strip 확정 후 Audiveris가 이 PDF만 사용합니다.

### C. 2단계 — OCR·P 유발 (서버 설정)

1. `GET /api/health` → `audiverisOcrLangEffective`가 **`"eng"`** 인지 확인 (한글을 Audiveris OCR에 맡기지 않을 때 권장).
2. `.env`에 `AUDIVERIS_OCR_LANG=kor+eng`가 있으면 세잇단 `3`→`P` OCR이 늘 수 있음 → 제거 후 재시작.
3. 변환 job 중 **OMR 품질 검토** 모달 또는 `GET /api/diagnostic/{jobId}/omr-policy`에서 `pCauses`·OCR 값 확인.

### D. 3단계 — MXL lint (CLI·API)

```bash
python scripts/mxl_quality_lint.py path/to/score.mxl --measure-offset 1 --page-count 10 --json report.json
python scripts/mxl_quality_lint.py score.mxl --page 3 --staff PL
```

- **인쇄 마디** ≈ MXL `measure@number` + **`MXL_MEASURE_OFFSET_PRINTED`**(기본 1, pickup 가정).
- 페이지는 마디 수를 페이지 수로 **균등 분할 추정**(`pageEstimate`) — 정확한 판면 매핑이 아님.

### E. 4단계 — 성부 라벨 + OMR HITL (웹 UI)

1. (선택) **문자 검토** 화면 상단에서 성부 라벨(S A T B PR PL)을 미리 적어 두면 Audiveris 이후에 초안으로 쓰입니다. **폰트 분리 모드**에서는 가사 역할·텍스트 **최종 검증 UI가 OMR·HITL 이후**에 열립니다(「OMR·HITL 후 PyMuPDF 가사 검증·편집」체크, 기본 켜짐). 미리보기는 **원본 PDF**(`input.pdf`)입니다.
2. Audiveris 종료 후 **성부 라벨 지정** 모달(OMR HITL 켜짐 시, 매 변환마다) — 확정 시 `part_labels.json`. 문자 검토만 끝낸 경우 `part_labels_preset.json`만 있어도 MXL·lint에 초안이 쓰이며, 완료 직전 서버가 `part_labels.json`으로 복사할 수 있습니다. 확정·초안 라벨은 **최종 MXL/MusicXML**의 `<part-name>`(내부 `<display-text>` 포함)·`instrument-name`·`midi-name` 등에 쓰입니다. Audiveris 기본 **Voice**는 `scripts/apply_part_labels.py`와 `inject_ocr.py` 마지막 단계에서 덮어씁니다. `PR`·`PL` → **Piano**(`Pno.`).
3. 「Audiveris 직후 OMR 품질 검토」체크 **켜짐**(기본)으로 변환.
4. **성부 라벨 지정** 모달에서 확정한 뒤 **OMR 페이지·성부 품질 검토** 모달이 열립니다(순서가 바뀌면 이어하기가 거절됨).
5. **OMR 페이지·성부 품질 검토** 모달 (MuseScore **불필요**):
   - **PDF**(156 DPI)와 **MusicXML(OSMD)** 를 나란히 표시. 성부 필터를 쓰면 MXL도 해당 파트만 표시.
   - 패널을 열면 **`GET …/score-musicxml`** 이 **요청마다 `fix_audiveris_mxl` 적용 후** MusicXML을 내려줍니다. **「MXL에 반영·미리보기」**·**sync-preview**는 **`audiveris_raw.mxl` 백업 → 후처리 → HITL 보정 재적용**으로 MXL 파일을 재합성합니다.
   - **MusicXML(OSMD) 악보에서 마디 클릭**으로 마디를 열고 direction·쉼표·음표·점(·)·이음줄 등을 요소별로 보정 → `omr_hitl_fixes.json`에 쌓음. 음표 **길이** 메뉴에 **「4분음표 · (점)」** 등 점 붙은 길이 선택 지원. **쉼표 옆 점(·)** 은 마디 편집의 `clearRestDots`(XML `<dot>`·duration·쉼표 뒤 잘못된 짧은 음표). 클릭 영역: `osmdMeasureClick.ts`가 성부 줄×마디 열 그리드(쉼표만 있는 마디 포함)·**클릭한 줄만** 하이라이트.
   - **「MXL에 반영·미리보기」** — 마디 편집 패널 하단 또는 대기 목록 위 버튼. 위 재합성 경로로 Audiveris MXL(`preInject`)에 보정 반영 후 **오른쪽 OSMD**에서 결과 확인.
   - **「OMR 자동 정리 (전체 성부)」** — 쉼표·피아노 m6 이음줄·세잇단 `show-number="both"`·가짜 staccato·P direction 일괄 정리.
   - **작업 저장(ZIP) / 작업 불러오기** — 검토 중단·재개용(`review.mxl`, `audiveris_raw.mxl`, `omr_hitl_fixes.json`, **`clean_score_only.pdf`·`input.pdf`** 등). **같은 job** 안에서는 「작업 불러오기」. **새 변환**에서는 **「omr-work.zip 이어하기」** + (예전 ZIP이면) **비교용 PDF** 선택 업로드.
   - **시작 단계 (같은 PDF 반복)** — ① **clean_score_only.pdf → OMR만**(가사 검증 생략), ② **clean_score + 가사 검증**, ③ **omr-work.zip 이어하기**(Audiveris 생략). 작업 표에 **OMR·HITL 대기** 진행 문구가 표시됩니다.
   - **이어하기** — 대기 보정을 MXL에 적용한 뒤, (가사 검증 켜짐 시) **`review_needed` 가사 검증·편집** → `merge_lyric_sources.py` → `inject_ocr`·최종 MXL로 진행.
   - 예전 **mxl-lint 자동 힌트 UI**는 제거됨. PDF·MXL 직접 대조와 마디 편집이 기준.
6. 성부 라벨·OMR 검토를 건너뛰거나 배포 중 `pm2 restart`를 하면 MXL에 Audiveris 기본 **Voice**가 남을 수 있습니다. **한 번에 한 job**만 끝까지 진행하세요. OMR 검토 중 **`pm2 restart` 전에는 「작업 저장(ZIP)」** 으로 진행을 백업하세요.
7. OMR HITL을 끄려면 체크 해제 또는 `enableOmrStaffReview=false` multipart 필드. **가사 검증 UI**를 끄려면 「OMR·HITL 후 PyMuPDF 가사 검증·편집」체크 해제 또는 `enablePymupdfReview=false`.

### F. 4c단계 — PyMuPDF 가사 검증 (폰트 분리, OMR·HITL 후)

1. OMR HITL **「이어하기」** 직후(또는 Audiveris 보정 모달을 거친 뒤) **「가사 검증·편집 (OMR·HITL 완료 후)」** 모달이 열립니다. 작업 표에 `가사 검증·편집 대기 (OMR·HITL 후)…`가 보이면 서버가 이 단계에서 멈춘 상태입니다.
2. **원본 PDF** PNG 미리보기에서 가사·제목·템포 등 역할을 확인·수정합니다. `lyric_manifest.json`만 업로드해 2단계부터 시작한 경우에도 manifest·원본 PDF에서 검토 데이터를 자동 준비합니다.
3. **「검증 완료 · 가사 주입 계속」** — `ocr_data_pymupdf.json` 저장 → `merge_lyric_sources.py` 재실행 → 교정된 MXL에 `inject_ocr.py`.

### G. 5단계 — Audiveris 보정 (선택)

1. 「Audiveris 직후 멈춤」체크 시 **Audiveris 결과 보정** 모달:
   - 원본 MXL 다운로드 → MuseScore 등에서 수정 → 교체 업로드 또는 조옮김(곡 전체에만).
   - **마스킹·인식 점검** 탭으로 `clean_score` vs 원본 PNG 비교.
2. MXL의 direction `P` 등 일부는 `scripts/fix_audiveris_mxl.py`로 후처리 가능 — **SYMBOLS UI는 그대로**일 수 있음.

### H. SYMBOLS·엔진 한계 (사람이 할 일)

| 현상 | 웹/스크립트로 | 사용자 |
|------|----------------|--------|
| 세잇단 괄호·PL 마디 세잇단 소실 | 자동 복구 어려움 | Audiveris GUI SYMBOLS/BEAMS, HITL 계획 |
| 이음줄·순서 대량 오류 | lint만 | PDF 품질·스캔, Audiveris 단계 디버깅 |
| 합창 예제 회귀 | `python scripts/verify_score_issues.py --regression` | [합창_피아노_SYMBOLS_오인식_대조.md](합창_피아노_SYMBOLS_오인식_대조.md) |

## API 요약

| 메서드 | 경로 | 용도 |
|--------|------|------|
| GET | `/api/diagnostic/:jobId/omr-policy` | OCR·상수·P 유발 경로 |
| GET | `/api/diagnostic/:jobId/mxl-lint?page=&staff=` | job별 lint. `part_labels.json`이 lint보다 최신이면 재생성·라벨 반영. `regen=1` 강제 재생성 |
| GET/POST | `/api/omr-hitl/:jobId/fixes` | 대기 중 OMR 보정 목록 |
| POST | `/api/omr-hitl/:jobId/apply` | 보정을 MXL에 적용·lint 재생성 (원본 백업에서 후처리·보정 재합성) |
| POST | `/api/omr-hitl/:jobId/sync-preview` | OMR 검토 미리보기 MXL 재빌드 |
| POST | `/api/omr-hitl/:jobId/normalize-rests` | 전체 성부 OMR 자동 정리 |
| GET | `/api/omr-hitl/:jobId/export-work` | OMR 검토 진행 ZIP 내보내기 |
| POST | `/api/omr-hitl/:jobId/import-work` | OMR 검토 진행 ZIP 불러오기 |
| GET | `/api/omr-hitl/:jobId/measure?partId=&measureMxl=` | 마디 내 음·쉼 목록 |
| POST | `/api/continue-omr-staff-review/:jobId` | OMR HITL 이어하기(보정 자동 적용) |
| GET | `/api/raw-mxl/:jobId` | `omr_staff_review_needed`·`audiveris_review_needed` 시 원본 MXL |

## 관련 문서

- [악보_변환_품질_가이드.md](악보_변환_품질_가이드.md)
- [Audiveris_엔진_한계와_대응.md](Audiveris_엔진_한계와_대응.md)
- [합창_피아노_SYMBOLS_오인식_대조.md](합창_피아노_SYMBOLS_오인식_대조.md)
