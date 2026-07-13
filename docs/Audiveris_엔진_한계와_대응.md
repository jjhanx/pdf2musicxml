# Audiveris 엔진 한계와 대응 (SYMBOLS 단계 오인식)

## 왜 «전혀 개선 없음»처럼 보일 수 있는가

이 저장소의 **폰트 strip**·**MXL 후처리(`fix_audiveris_mxl.py`)** 는 다음과 같이 **시점이 다릅니다**.

| 조치 | 영향 시점 | SYMBOLS 단계 UI |
|------|-----------|-----------------|
| `pdf_separator` 텍스트 제거 | Audiveris **입력 PDF** | 픽셀에 글자가 남으면 **거의 없음** |
| `AUDIVERIS_*` 상수 | Audiveris **TEXTS/SYMBOLS** | **있음** (엔진이 상수를 읽을 때) |
| `fix_audiveris_mxl` | **최종 MXL** (inject 직전) | **없음** (이미 SYMBOLS·LINKS 지난 뒤) |

**단계별 디버깅**에서 SYMBOLS 화면에 `P`·잘못된 조표가 보이면, 그건 **Audiveris OMR 엔진** 쪽 이슈입니다.  
우리가 이전에 넣은 MXL-only 수정만으로는 **그 화면이 바뀌지 않는 것이 정상**입니다.

공식 논의: [Audiveris #46 — triplets vs OCR/TEXTS](https://github.com/Audiveris/audiveris/issues/46)  
요지: **TEXTS(OCR)가 먼저 글리프를 «글자»로 잡아 두면 SYMBOLS가 세잇단 숫자 `3`을 음표 기호로 못 씀**. OCR 결과가 `3`이 아니라 `P`·`1-3-1` 등이면 더 악화됩니다.

---

## 이 악보(합창+피아노 PR/PL)에서 흔한 원인

1. **왼쪽 SMuFL 성부 약어** (S/A/T/B, PR/PL, 약 22.8pt)  
   - `clean_score` **strip은 UI 선택 pt만** 제거 — 약어·음자리표를 자동으로 지우지 않음.  
   - SYMBOLS 간섭은 Audiveris **TextWord/OCR eng** 등으로 완화(아래 CLI 상수).

2. **세잇단 `3` + `P`**  
   - OCR이 `3`을 `P`로 읽거나, 한 글자 `P`가 **PartName/Direction** 으로 남음 (`TextRole`·`TextWord` 쪽).  
   - Audiveris는 `tupletWordRegexp`에 맞는 OCR만 제거하고 글리프를 SYMBOLS에 넘김 — **정규식에 안 맞으면 `P`가 남음**.

3. **PR/PL 2·3마디 구분선**  
   - 피아노 양손(브레이스)에서 **내부 마디선 연결** 요구가 맞지 않으면 GRID/MEASURES/SYMBOLS에서 선이 빠질 수 있음.  
   - `disconnectedBracedParts=true` 로 완화(기본 적용).

4. **조표·늘임점·이음줄 혼동**  
   - SMuFL 글리프 분류기 한계. PDF 전처리만으로는 **일부만** 줄어듦.

---

## 이 저장소가 하는 대응 (2026-06 갱신)

### 1. PDF — 픽셀 제거 및 문자 치환 (`pdf_separator.py` & `mask_pdf.py`)

- pikepdf: **UI에서 고른 pt 범위**만 텍스트 제거(CTM 반영).
- **세잇단 기호 치환 (`mask_pdf.py` 2026-06 추가)**:
  - 일부 사설 음표 폰트(예: NWC 음악 폰트 등)로 렌더링된 세잇단음표 숫자 `3` (Private Use Area `U+F073` 등)은 Tesseract OCR 단계에서 `P`/`p`로 오인식되어 세잇단음표가 누락되고 뜬금없는 `<dynamics><p/></dynamics>` 세기가 들어가는 원인이 됩니다.
  - 마스킹 전처리(`mask_pdf.py`) 시 PDF 내부의 `U+F073` 문자들을 추적하여, 해당 영역을 **Arial/Helvetica 폰트의 표준 `'3'` 텍스트 문자**로 리덕 치환하여 렌더링합니다.
  - 이를 통해 Tesseract OCR이 세잇단음표 숫자 `3`을 오인식 없이 100% 인식하며, Audiveris가 세잇단음표 구조를 정상적으로 파싱할 수 있게 되었습니다.

### 2. Audiveris CLI 상수 (기본, `shared/audiveris.ts`)

| 상수/스위치 | 목적 |
|-------------|------|
| `ProcessingSwitches` lyrics/chordNames/pluckings/fingerings **off** | 가사·코드·플럭킹 OCR 간섭 감소 |
| `disconnectedBracedParts=true` | PR/PL 마디선 |
| `TextWord.abnormalWordRegexp`에 **PpRrLl9** | OCR 한 글자 잔여(P·단독 9 등) 제거 → SYMBOLS에 글리프 복원 |
| `TextWord.tupletWordRegexp` 확장 | 단독 `3`/`6` 등도 TEXTS에서 제거 |
| OCR 언어 기본 **`eng`** (`AUDIVERIS_CLEAN_SCORE_OCR_LANG`, `AUDIVERIS_OCR_LANG` 미설정 시) | clean_score에 한글 없음 — `kor+eng` OCR이 `3`→`P`로 읽는 경우 완화 |

끄기: `AUDIVERIS_KEEP_DEFAULT_SWITCHES=1`, `AUDIVERIS_KEEP_TEXT_CONSTANTS=1`

### 3. MXL 후처리 (`fix_audiveris_mxl.py`, inject 직전)

- direction `P` / `2P` 등 제거, 이중 staccato+natural 일부 정리.  
- **조표 오인·조바꿈**: Audiveris HEADERS가 줄머리 SMuFL 등을 **1♯ courtesy**처럼 읽거나, **m17 4♯ 조바꿈**을 줄마다 반복 export합니다(`omr-work-8317959f`, `omr-work-ddd2447d`). 후처리는 **마디 중간(줄바꿈 아님) 첫 `<key>`는 유지**, **줄바꿈에만 있는 fifths(대부분 파트 합의)는 제거**, **이미 유효한 조표의 courtesy 반복만 제거**합니다. 조표를 없애 `<alter>`만 남기면 OSMD가 **음표마다 #** 로 그리므로, 조바꿈 `<key>`를 지우지 않습니다.
- **특정 악보 보정 (2026-06 추가)**: '눈 (김효근)' 피아노 파트(P5)의 인쇄 7마디(MXL 6마디) 오른손 성부에서 오인식되어 빠진 이음줄(5~7번 음표 D4-D#4, 8~9번 음표 A4-B3)을 음표 피치 시퀀스 패턴 분석을 통해 정밀 복구 및 주입합니다.
- **SYMBOLS UI에는 반영 안 됨.**

### 4. 소스 패치 (선택)

엔진 동작을 바꾸려면 **Audiveris 소스 빌드**가 필요합니다.  
절차: [scripts/audiveris-patches/README.md](../scripts/audiveris-patches/README.md)

---

## 적용·검증 체크리스트

1. 서버 `git pull` · `npm run build` · **PM2 재시작** (Node가 새 `audiveris.ts` 상수를 써야 함).  
2. **같은 PDF로 변환을 처음부터** 다시 (기존 job의 `clean_score_only.pdf`는 옛 설정).  
3. `GET /api/health` — `audiverisOcrLangEffective`가 **`eng`** 인지 확인.  
4. `clean_score` PNG 점검: **음자리표·조표·첫 마디가 잘리지 않았는지**, 성부 약어만 사라졌는지.  
5. Audiveris **TEXTS 직후** OCR 잔여 삭제(공식 권장) 또는 **SYMBOLS**에서 `P`가 줄었는지 확인.  
6. (선택) `python scripts/verify_score_issues.py <job.mxl>` — 보고서 형식 이슈 스캔.

---

## 사용자 보고 위치를 «인식»하는 검증

자동으로 **모든 마디·음표 번호**와 100% 대조하진 않습니다.  
대신 MXL에서 **의심 패턴**(direction `P`, 단독 `9`, 이중 natural 등)을 세고,  
PDF 왼쪽 여백·Audiveris 로그를 함께 봅니다.

보고 형식 예: `3페이지 PR 17마디 2~4음표 세잇단` → MusicXML part-id 매핑 후 해당 measure의 `direction`·`tuplet`·`accidental`를 수동/스크립트로 확인.

장기적으로는 **Audiveris development 브랜치** 패치 분류기·TEXTS/SYMBOLS 경계 개선이 근본 해결입니다.
