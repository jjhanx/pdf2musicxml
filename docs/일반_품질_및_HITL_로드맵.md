# 일반 악보 품질·HITL 로드맵

예제 PDF용 pt/x 하드코딩은 쓰지 않습니다. 품질은 **환경·UI 선택·Audiveris 엔진·MXL lint·사람 검토(HITL)** 로 단계적으로 다룹니다.

## 구현 순서 (권장)

| 단계 | 내용 | 저장소 |
|------|------|--------|
| 1 | **폰트 strip**: UI에서 고른 pt만 제거 (`clean_score_only.pdf`) | `scripts/pdf_separator.py` |
| 2 | **OMR 정책 노출**: OCR `eng`, TextWord 상수, P 유발 경로 | `GET /api/diagnostic/:jobId/omr-policy`, `shared/audiveris.ts` |
| 3 | **MXL lint**: 악보 무관 휴리스틱 (P direction, 마디 끝 쉼표, 마디 경계 순서) | `scripts/mxl_quality_lint.py`, `GET …/mxl-lint` |
| 4a | **성부 라벨 지정**: Audiveris MXL part-list → S/A/T/B/PR/PL 등 (PDF **p.** 와 구분) | `part_labels_needed`, `part_labels.json` |
| 4b | **페이지×staff HITL**: lint UI → 이어하기 | `omr_staff_review_needed`, `OmrStaffReviewPanel` |
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
2. `clean_score_only.pdf`를 **마스킹·인식 점검** 또는 다운로드로 열어, 왼쪽 음자리표·첫 마디가 잘리지 않았는지 확인.
3. strip 확정 후 Audiveris가 이 PDF만 사용합니다.

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

1. (선택) **문자 검토** 화면 상단에서 성부 라벨(S A T B PR PL)을 미리 적어 두면 Audiveris 이후에 초안으로 쓰입니다.
2. Audiveris 종료 후 **성부 라벨 지정** 모달(OMR HITL 켜짐 시, 매 변환마다) — 확정 시 `part_labels.json`. 문자 검토만 끝낸 경우 `part_labels_preset.json`만 있어도 MXL·lint에 초안이 쓰이며, 완료 직전 서버가 `part_labels.json`으로 복사할 수 있습니다. 확정·초안 라벨은 **최종 MXL/MusicXML**의 `<part-name>`(내부 `<display-text>` 포함)·`instrument-name`·`midi-name` 등에 쓰입니다. Audiveris 기본 **Voice**는 `scripts/apply_part_labels.py`와 `inject_ocr.py` 마지막 단계에서 덮어씁니다. `PR`·`PL` → **Piano**(`Pno.`).
3. 「Audiveris 직후 OMR 품질 검토」체크 **켜짐**(기본)으로 변환.
4. **OMR 페이지·성부 품질 검토** 모달:
   - 상단 **PDF 미리보기**(156 DPI, 페이지 너비)와 대조.
   - **Lint 칩은 PDF 이미지 위가 아님** — PDF 바로 아래 **파란 테두리 박스**「Lint 결과」에 표시. 성부별 회색 줄은 같은 내용을 성부로 나눈 보기. 칩·성부 이름은 **`part_labels.json` 라벨**(S/A/T/B 등)을 쓰며 MusicXML `P1`·`P3` id와 다릅니다.
   - `mxl-lint` 실패 시 노란 안내에 **Python 오류 요약**이 표시됨 — PDF만 보고 **이어하기** 가능.
   - **이어하기** → 가사·메타 `inject_ocr` 단계로 진행.
5. 성부 라벨·OMR 검토를 건너뛰거나 배포 중 `pm2 restart`를 하면 MXL에 Audiveris 기본 **Voice**가 남을 수 있습니다. **한 번에 한 job**만 끝까지 진행하세요.
6. OMR HITL을 끄려면 체크 해제 또는 `enableOmrStaffReview=false` multipart 필드.

### F. 5단계 — Audiveris 보정 (선택)

1. 「Audiveris 직후 멈춤」체크 시 **Audiveris 결과 보정** 모달:
   - 원본 MXL 다운로드 → MuseScore 등에서 수정 → 교체 업로드 또는 조옮김(곡 전체에만).
   - **마스킹·인식 점검** 탭으로 `clean_score` vs 원본 PNG 비교.
2. MXL의 direction `P` 등 일부는 `scripts/fix_audiveris_mxl.py`로 후처리 가능 — **SYMBOLS UI는 그대로**일 수 있음.

### G. SYMBOLS·엔진 한계 (사람이 할 일)

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
| POST | `/api/continue-omr-staff-review/:jobId` | OMR HITL 이어하기 |
| GET | `/api/raw-mxl/:jobId` | `omr_staff_review_needed`·`audiveris_review_needed` 시 원본 MXL |

## 관련 문서

- [악보_변환_품질_가이드.md](악보_변환_품질_가이드.md)
- [Audiveris_엔진_한계와_대응.md](Audiveris_엔진_한계와_대응.md)
- [합창_피아노_SYMBOLS_오인식_대조.md](합창_피아노_SYMBOLS_오인식_대조.md)
