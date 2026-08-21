# 일반 악보 품질·HITL 로드맵

예제 PDF용 pt/x 하드코딩은 쓰지 않습니다. 품질은 **환경·UI 선택·Audiveris 엔진·MXL lint·사람 검토(HITL)** 로 단계적으로 다룹니다.

## 구현 순서 (권장)

| 단계 | 내용 | 저장소 |
|------|------|--------|
| 1 | **폰트 strip**: UI에서 고른 pt만 제거 (`clean_score_only.pdf`) | `scripts/pdf_separator.py` |
| 2 | **OMR 정책 노출**: OCR `eng`, TextWord 상수, P 유발 경로 | `GET /api/diagnostic/:jobId/omr-policy`, `shared/audiveris.ts` |
| 3 | **MXL lint**: 악보 무관 휴리스틱 (P direction, 마디 끝 쉼표, 마디 경계 순서) | `scripts/mxl_quality_lint.py`, `GET …/mxl-lint` |
| 4a | **성부 라벨 지정**: Audiveris MXL part-list → S/A/T/B/M/W/U/PR/PL 등 (PDF **p.** 와 구분) | `part_labels_needed`, `part_labels.json` |
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

이미지 PDF의 `clean_score`가 수백 MB였다가 JPEG로 줄인 뒤 **연속 쉼표 마디**가 보이면, 옛 JPEG 재인코딩 산출물입니다. `git pull` 후 **원본 PDF로 변환을 처음부터** 다시 하세요(같은 job의 옛 `clean_score`를 재사용하지 않음). 가사는 픽셀에서 지우고, 용량은 무손실 PNG/Flate만 씁니다.

3단계 `omr-work.zip` 업로드가 **413 Request Entity Too Large**(nginx HTML)면 Node가 아니라 **앞단 nginx 1MB 한도**입니다. `client_max_body_size 256m;` 후 `sudo nginx -s reload`. ZIP이 ~100MB인 이유는 `input.pdf`와 같은 `deskewed.pdf`가 중복 포함된 경우가 많습니다.

피아노 PL처럼 같은 오선에 voice가 둘이면, 미리보기에서 짧은 쉼표는 음자리표 중선에 걸칩니다(F=D3). 강력 새로고침 후 해당 마디를 다시 보면 됩니다.

### B. 1단계 — clean_score 만들 때 (폰트 strip)

1. 변환 시작 → **폰트 크기 선택** UI가 뜨면:
   - **제목·가사**에 해당하는 **큰 pt만** 선택 (예: 20pt대 제목).
   - **음자리표·음표·조표**(보통 ~22.8pt 등)는 **선택하지 않음**.
2. **clean_score_only.pdf 확인** 모달에서 **원본 vs clean_score** PNG를 나란히 보고, **음표 머리·오선**이 남았는지 확인합니다. **「clean_score PDF 저장」**으로 로컬에 남길 수 있습니다.
3. 확인 후 **lyric_manifest.json 저장** 모달이 열립니다(pdfplumber·PyMuPDF 병합 직후). **2단계 이어하기**용으로 JSON을 저장한 뒤 OMR로 진행합니다.
4. 문제가 있으면 **「폰트 범위 다시 선택」** → 범위를 좁힌 뒤 재생성. 확인 후 **「Audiveris로 계속」**.
5. strip 확정 후 Audiveris가 이 PDF만 사용합니다.

### C. 2단계 — OCR·P 유발 (서버 설정)

1. `GET /api/health` → `audiverisOcrLangEffective`가 **`"eng"`** 인지 확인 (한글을 Audiveris OCR에 맡기지 않을 때 권장).
2. `.env`에 `AUDIVERIS_OCR_LANG=kor+eng`가 있으면 세잇단 `3`→`P` OCR이 늘 수 있음 → 제거 후 재시작.
3. 변환 job 중 **OMR 품질 검토** 모달 또는 `GET /api/diagnostic/{jobId}/omr-policy`에서 `pCauses`·OCR 값 확인.

### D. 3단계 — MXL lint (CLI·API)

```bash
python scripts/mxl_quality_lint.py path/to/score.mxl --measure-offset 1 --page-count 10 --json report.json
python scripts/mxl_quality_lint.py score.mxl --page 3 --staff PL
python _smoke/audit_preview_voice_flatten.py   # omr-work*.zip — OSMD split 미리보기 순차 voice 평탄화 회귀(리듬 시각 불변)
python _smoke/audit_key_change_clef_misread.py # omr-work*.zip — 조바꿈 F clef→key·courtesy clef 제거(전 zip 악화 없음)
python _smoke/audit_measure_numbering_strip.py # omr-work*.zip — measure-numbering 전부 제거
python _smoke/test_measure_numbering_strip.py  # measure-numbering 제거 회귀
python _smoke/test_printed_measure_numbers_circled.py  # 원문자·줄머리 OCR 병합(13 T)·페이지 우상단 오인 제외
```

- **인쇄 마디** ≈ MXL `measure@number` + **`MXL_MEASURE_OFFSET_PRINTED`**(기본 1). `lyric_manifest`는 **좌측 줄머리(x<130pt)**·`spans[0]` 앞쪽 숫자·`"13 T"`류 leading extract로 OCR 병합 줄에서 마디 번호를 복원합니다.
- 페이지는 마디 수를 페이지 수로 **균등 분할 추정**(`pageEstimate`) — 정확한 판면 매핑이 아님.

### E. 4단계 — 성부 라벨 + OMR HITL (웹 UI)

1. (선택) **문자 검토** 화면 상단에서 성부 라벨(S A T B PR PL)을 미리 적어 두면 Audiveris 이후에 초안으로 쓰입니다. **폰트 분리 모드**에서는 가사 역할·텍스트 **최종 검증 UI가 OMR·HITL 이후**에 열립니다(「OMR·HITL 후 PyMuPDF 가사 검증·편집」체크, 기본 켜짐). 미리보기는 **원본 PDF**(`input.pdf`)입니다.
2. Audiveris 종료 후 **성부 라벨 지정** 모달(OMR HITL 켜짐 시, 매 변환마다) — 확정 시 `part_labels.json`. 문자 검토만 끝낸 경우 `part_labels_preset.json`만 있어도 MXL·lint에 초안이 쓰이며, 완료 직전 서버가 `part_labels.json`으로 복사할 수 있습니다. 확정·초안 라벨은 **최종 MXL/MusicXML**의 `<part-name>`(내부 `<display-text>` 포함)·`instrument-name`·`midi-name` 등에 쓰입니다. Audiveris 기본 **Voice**는 `scripts/apply_part_labels.py`와 `inject_ocr.py` 마지막 단계에서 덮어씁니다. **S/A/T/B/M/W/U/P** 등은 라벨 그대로, 양손 피아노 **PR·PL**만 **Piano**(`Pno.`).
3. 「Audiveris 직후 OMR 품질 검토」체크 **켜짐**(기본)으로 변환.
4. **성부 라벨 지정** 모달에서 확정한 뒤 **OMR 페이지·성부 품질 검토** 모달이 열립니다(순서가 바뀌면 이어하기가 거절됨).
5. **OMR 페이지·성부 품질 검토** 모달 (MuseScore **불필요**):
   - **PDF**(156 DPI)와 **MusicXML(OSMD)** 를 나란히 표시. 성부 필터를 쓰면 MXL도 해당 파트만 표시.
   - 패널을 열면 **`GET …/score-musicxml`** 은 **OMR 검토 중** `syncOmrReviewMxl`( **`audiveris_raw.mxl` + HITL 보정만**, score patch·`fix_audiveris_mxl`·rest 정규화 **미적용**) 후 XML을 추출합니다. HITL 보정이 **한 번도 없으면** `omr_hitl_baseline.mxl` 대신 **항상 raw**에서 복원(`restore-from-raw`). OSMD 미리보기는 **verbatim**: part 라벨·PR/PL split 외 **저장 MXL 변환 없음**. 단, OSMD 버그·phantom clef·phantom 마디 번호 방지를 위해 **load 직전 미리보기 전용**으로 m1 C major 명시·전역 조바꿈 F clef 오인·courtesy clef·**OSMD 자동 마디 번호 끔** + manifest `printedMeasureMarkers`·**HITL 셈여림(`<notations><dynamics>`→`<direction>` 승격)**·grand staff key 통일·**PL/PR direction 재부착(staff→1 전)+tempo words ZWSP**을 적용합니다. **저장 MXL에 후처리를 반영**하려면 「OMR 자동 정리」를 실행하세요.
   - **MusicXML(OSMD) 악보에서 마디 클릭**으로 마디를 열고 direction·쉼표·음표·점(·)·이음줄·**꾸밈음(ornament)**·**셈여림 점선(wedge)** 등을 요소별로 보정 → `omr_hitl_fixes.json`에 쌓음. 음표 **길이** 메뉴에 **「4분음표 · (점)」** 등 점 붙은 길이 선택 지원. **쉼표 옆 점(·)** 은 마디 편집의 `clearRestDots`(XML `<dot>`·duration·쉼표 뒤 잘못된 짧은 음표). **원본에 없는 지그재그(inverted-mordent)** 는 음표의 **꾸밈음 제거**. **tenuto·accent 등 표**는 추가·삭제와 **위/아래 위치**(`setArticulationPlacement`). **이음줄**도 추가·삭제와 **위/아래 위치**(`addSlur`·`setSlurPlacement`). 크레센도/디미뉴엔도 점선은 **셈여림 점선** 패널에서 시작·끝 음으로 추가하고 `wedge(stop)`을 **끝 음 바로 뒤**(마디 barline이 아님)에 두어 길이를 옮김. 마지막 음까지여도 stop을 마디 끝에 두면 OSMD가 다음 마디 끝까지 그림. **화음 안의 같은 피치 중복**은 하나만 남기고, 음 삭제는 **그 멤버만** 지운다. 클릭 영역: `osmdMeasureClick.ts`가 성부 줄×마디 열 그리드(쉼표만 있는 마디 포함)·**클릭한 줄만** 하이라이트.
   - **「MXL에 반영·미리보기」** — 마디 편집 패널 하단 또는 대기 목록 위 버튼. 위 재합성 경로로 Audiveris MXL(`preInject`)에 보정 반영 후 **오른쪽 OSMD**에서 결과 확인.
   - **「OMR 자동 정리 (전체 성부)」** — 쉼표·피아노 m6 이음줄·세잇단 `show-number="actual"`·빔 없으면 bracket·가짜 staccato·P direction 일괄 정리.
   - **작업 저장(ZIP) / 작업 불러오기** — 검토 중단·재개용(`review.mxl`, `audiveris_raw.mxl`, `omr_hitl_fixes.json`, **`clean_score_only.pdf`·`input.pdf`·`lyric_manifest.json`** 등). **같은 job** 안에서는 「작업 불러오기」. **새 변환**에서는 **3단계 omr-work.zip**(+ 예전 ZIP이면 **비교용 PDF**) 또는 **4단계 omr-work.zip + 가사 JSON**으로 이어갑니다.
   - **변환 시작 단계 (같은 PDF 반복)** — ① **원본 PDF**(선택: **omr-work.zip**으로 Audiveris 생략·기존 MXL로 HITL), ② **clean_score_only.pdf + 분리된 가사 JSON**(필수), ③ **omr-work.zip**(가사 포함), ④ **omr-work.zip**(교정 완료 MXL) + **가사 JSON**. 작업 표에 **OMR·HITL·가사 검증** 대기 진행 문구가 표시됩니다.
   - **디버그 ZIP 다운로드 (General Solution)** — 작업이 완료(done), 검토 대기(HITL), 오류(error) 상태일 때 등 사용자가 내부 OMR 실행 결과 로그 및 중간 산출물을 직접 확인하고 이슈를 리포팅할 수 있도록, **모든 작업 종료/일시정지 상태에서 `디버그 ZIP 다운로드` 버튼이 항상 노출**됩니다. 모달을 닫은 상태라도 언제든 문제 상황을 디버깅할 수 있습니다.
   - **이어하기** — 대기 보정을 MXL에 적용한 뒤, (가사 검증 켜짐 시) **`review_needed` 가사 검증·편집** → `merge_lyric_sources.py` → `inject_ocr`·최종 MXL로 진행.
   - 예전 **mxl-lint 자동 힌트 UI**는 제거됨. PDF·MXL 직접 대조와 마디 편집이 기준.
7. 성부 라벨·OMR 검토를 건너뛰거나 배포 중 `pm2 restart`를 하면 MXL에 Audiveris 기본 **Voice**가 남을 수 있습니다. **한 번에 한 job**만 끝까지 진행하세요. OMR 검토 중 **`pm2 restart` 전에는 「작업 저장(ZIP)」** 으로 진행을 백업하세요.
7. OMR HITL을 끄려면 체크 해제 또는 `enableOmrStaffReview=false` multipart 필드. **가사 검증 UI**를 끄려면 「OMR·HITL 후 PyMuPDF 가사 검증·편집」체크 해제 또는 `enablePymupdfReview=false`.

### F. 4c단계 — PyMuPDF 가사 검증 (폰트 분리, OMR·HITL 후)

1. OMR HITL **「이어하기」** 직후(또는 Audiveris 보정 모달을 거친 뒤) **「가사 검증·편집 (OMR·HITL 완료 후)」** 모달이 열립니다. 작업 표에 `가사 검증·편집 대기 (OMR·HITL 후)…`가 보이면 서버가 이 단계에서 멈춘 상태입니다. 프론트는 `review_needed` **진입마다** 모달을 띄우며(OMR 패널이 닫힌 뒤 재시도), 다른 대기 모달이 열려 있으면 잠시 보류했다가 자동으로 엽니다.
2. **원본 PDF** PNG 미리보기에서 가사·제목·템포 등 역할을 확인·수정합니다. **2·4단계**(`clean_score`·`lyric_inject` + `lyric_manifest.json`)로 시작하면 **1단계에서 편집·저장한 manifest 항목**(역할·성부 순번·bbox·수동 마스킹 영역)을 **그대로** 이어 받습니다. `lyric_manifest.json`에 **`partLabelsByIndex`** 가 있으면 성부 라벨 preset도 복원됩니다. **1단계 full**만 처음 돌릴 때는 PDF 1차 추출 후 **구분 기본값 가사**로 시작합니다(표현어 등은 **미분류**로 바꿔 제외).
    - **일반 해결책**: 수동 마스킹 영역(가사 등) 추가 시 새 텍스트 박스로 포커스를 자동 이동하도록 UX가 개선되었습니다.
    - **일반 해결책**: 검토 완료 전(결과 파일 생성 중)에 `clean_score.pdf` 다운로드 링크가 미리 노출되던 문제를 수정하고, 결과 PDF 생성 시 서버에서 제공하는 진행 상황 텍스트(예: "추출된 텍스트 영역 마스킹 중...")를 화면에 표시하여 사용자 경험을 개선했습니다.
3. **「검증 완료 · 가사 주입 계속」** — `ocr_data_pymupdf.json` 저장 → `merge_lyric_sources.py` 재실행 → 교정된 MXL에 `inject_ocr.py`.

### G. 5단계 — Audiveris 보정 (선택)

1. 「Audiveris 직후 멈춤」체크 시 **Audiveris 결과 보정** 모달:
   - 원본 MXL 다운로드 → MuseScore 등에서 수정 → 교체 업로드 또는 조옮김(곡 전체에만).
   - **마스킹·인식 점검** 탭으로 `clean_score` vs 원본 PNG 비교.
2. MXL의 direction `P` 등 일부는 `scripts/fix_audiveris_mxl.py`로 후처리 가능 — **SYMBOLS UI는 그대로**일 수 있음.

### H. SYMBOLS·엔진 한계 (사람이 할 일)

| 현상 | 웹/스크립트로 | 사용자 |
|------|----------------|--------|
| 빔 없는 세잇단 괄호(4분·2분+4분 등) | HITL 「세잇단 적용」+ **음표 길이 유지**(혼합 길이)·`fix_audiveris_mxl` bracket 규칙. 검증: `python _smoke/test_triplet_hitl.py` | 마디 편집에서 범위·기준 박자 지정 |
| 원본에 없는 지그재그 꾸밈음(inverted-mordent 등) | HITL 음표 **꾸밈음 제거/추가**. 검증: `python _smoke/test_ornament_wedge_hitl.py` | 마디 편집에서 해당 음 선택 |
| tenuto·accent 등이 음표 위/아래에 잘못 붙음 | HITL 표 **위치 위/아래** (`setArticulationPlacement`). 검증: `python _smoke/test_articulation_placement_hitl.py` | 마디 편집. 곡·마디 하드코딩 없음 |
| 셈여림 점선(wedge) 없음·길이 오류 | HITL **셈여림 점선** 패널에서 시작→끝 추가, `wedge(stop)`을 끝 음 **뒤**로 이동(barline 금지). **PR/PL은 staff별로 독립** 표시·추가·삭제(짝 stop도 같은 staff만). OSMD split 미리보기: voice-layer normalize가 **direction staff를 지우지 않음** + stop voice를 backup 너머 voice1에 붙이지 않음(PL diminuendo 소실 방지). 검증: `python _smoke/test_ornament_wedge_hitl.py` · `npx tsx _smoke/test_wedge_last_note_preview.ts` · `npx tsx _smoke/test_b02f_pl_wedge_reanchor.ts` · `npx tsx _smoke/test_b02f_pl_wedge_full_pipeline.ts` | 마디 편집. 곡·마디 하드코딩 없음 |
| PL 미리보기에 일부 음만 보임(편집기에는 전부) | (1) `capBackupDurations`를 **voice별 cursor**로 — PR이 마디를 채운 뒤 backup 없이 이어지는 PL duration을 1로 뭉개지 않음. (2) voice-layer normalize는 backup 앞쪽이 **실음**이면 버리지 않고 이어 붙임(REST-only prefix만 제거). 검증: `npx tsx _smoke/test_e427_m10_pl_preview.ts` | OSMD 미리보기 전용. 저장 MXL 불변 |
| 화음에 같은 음높이·박자가 두 번(원본에 없는 유니즌) | 화음 그룹에서 동일 pitch는 하나만 남김. `removeNote`는 **선택한 음만** 삭제(리더를 지우면 다음 멤버가 리더). 검증: `python _smoke/test_chord_duplicate_pitch_hitl.py` · `npx tsx _smoke/test_chord_duplicate_pitch_preview.ts` | 마디 편집에서 남은 중복만 삭제. 곡·마디 하드코딩 없음 |
| 단일 오선 음표가 다른 파트(예: B)에 배정되어 고친 내용 재배분 필요 | HITL **마디 파트 복사/이동** (`copyMeasureContent`). 출처 파트(B)의 특정 마디 또는 범위를 대상 파트(S, A 등)로 복사/이동하며, 2성부/화음 상하 분할 및 출처 온쉼표 처리 지원. | 마디 편집 패널 「마디 파트 복사 / 이동」 |
| 파트의 앞머리 또는 중간 음자리표가 잘못 배정됨 (예: Alto가 F clef로 고정) | HITL **음자리표 변경** (`setMeasureClef`). 특정 파트의 음자리표를 높은음자리표(𝄞) 또는 낮은음자리표(𝄢)로 1마디부터 곡 전체 또는 지정 범위에 변경 적용. | 마디 편집 패널 「음자리표 변경」 |
| 이음줄이 음표 위/아래에 잘못 붙음 | HITL 이음줄 **위치 위/아래** (`addSlur`·`setSlurPlacement`). 검증: `python _smoke/test_slur_placement_hitl.py` | 마디 편집. 곡·마디 하드코딩 없음 |
| 이음줄(slur) 끊김·중복 번호 충돌·고아 stop으로 인한 끊어진 꼬리 렌더링 | **이음줄 자동 정규화** (`normalize_slurs_in_root` / `normalizeSlursForOsmdPreview`). 같은 음에 start/stop이 여러 개면 **bezier·default-x/y 없는 쪽**을 남기고, 좌표 있는 OMR 곡선·고아 stop을 제거. **stop은 같은 staff+number에만 짝짓기**(다른 number open start에 붙이지 않음 — HITL 긴 이음줄이 OMR 짧은 stop에 가로채이지 않음). start number는 가능하면 유지. **같은 마디에서 stop 직후 number 재사용 금지**(PR/PL 시간 겹침 시 OSMD 한쪽 소실 방지). `addSlur`는 from~to 사이 같은 staff 잔여 slur 제거. 검증: `python _smoke/test_m9_slur_prefer_clean.py` · `python _smoke/test_m9_slur_distinct_numbers.py` · `python _smoke/test_m10_slur_orphan_stop.py` · `npx tsx _smoke/test_e363_m9_pl_slur_timeline.ts` | OMR 파이프라인 및 OSMD 미리보기 자동 적용. 곡·마디 하드코딩 없음 |
| PL 마디 세잇단 소실 | 자동 복구 어려움 | Audiveris GUI SYMBOLS/BEAMS, HITL |
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
| POST | `/api/omr-hitl/:jobId/export-work/start` | OMR 검토 ZIP 백그라운드 생성 |
| GET | `/api/omr-hitl/:jobId/export-work/status` | 작업 저장 진행률 % |
| GET | `/api/omr-hitl/:jobId/export-work/file` | 준비된 ZIP 다운로드 |
| POST | `/api/omr-hitl/:jobId/import-work` | OMR 검토 진행 ZIP 불러오기 |
| GET | `/api/omr-hitl/:jobId/measure?partId=&measureMxl=` | 마디 내 음·쉼 목록 |
| POST | `/api/continue-omr-staff-review/:jobId` | OMR HITL 이어하기(보정 자동 적용) |
| GET | `/api/raw-mxl/:jobId` | `omr_staff_review_needed`·`audiveris_review_needed` 시 원본 MXL |

## 관련 문서

- [악보_변환_품질_가이드.md](악보_변환_품질_가이드.md)
- [Audiveris_엔진_한계와_대응.md](Audiveris_엔진_한계와_대응.md)
- [합창_피아노_SYMBOLS_오인식_대조.md](합창_피아노_SYMBOLS_오인식_대조.md)
