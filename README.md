# pdf2musicxml (pdf2mxl-audiveris)

PDF 악보를 **Audiveris**로 변환해 **MusicXML(`.mxl` / `.musicxml`)** 로 내려받는 도구입니다.  
프론트는 **Vite + React + TypeScript**, API는 **Express**이며 [mxlplayer](https://github.com/jjhanx/mxlplayer)와 같은 계열의 웹 스택입니다.

- **Audiveris MXL 없음(HTTP 422)**: 출력 폴더에 `.mxl`/`.musicxml`이 없을 때입니다. 로그에 `Can't connect to X11`·`java.awt.AWTError`가 보이면 **헤드리스 Linux**에서 `DISPLAY`만 잡혀 Audiveris가 GUI 초기화에 실패한 경우입니다. 앱은 Audiveris 실행 시 `JAVA_TOOL_OPTIONS`에 `-Djava.awt.headless=true`를 붙이도록 되어 있으며, 그래도 안 되면 `unset DISPLAY` 후 PM2 재시작을 검토하세요. 로그에 `WARN [#10]`·`ERS`가 보이면 **10번째 악보 장(sheet)** 처리 문제인 경우가 많습니다. 동일 PDF를 Audiveris GUI로 열어 해당 장을 확인하세요.

## 최근 변경 (폰트 분리 + 가사 병합 파이프라인)

- **변환 방식 선택(웹 UI)**: 업로드 전 **변환 방식**을 고릅니다.
  - **폰트 크기 분리 + Audiveris + 가사 병합**(권장): pdfplumber로 `extracted_music_text.json` 추출 → **폰트 크기 선택 UI**(표·프리셋·사용자 범위) → pikepdf로 `clean_score_only.pdf` 생성 → (선택) PyMuPDF 가사 검증 → 병합·Audiveris·주입.
  - **PyMuPDF 검증 + 마스킹**: 기존 `extract_text.py` → 검토 UI → `mask_pdf.py` → Audiveris → 주입.
  - **Audiveris만**: 선행 처리·가사 주입 없음.
- **PyMuPDF 검증은 선택**: 폰트 분리 모드에서 「PyMuPDF 가사 검증·편집」 체크를 끄면 pdfplumber 추출만으로 병합합니다.
- **점검 UI**: 완료 후 **마스킹·인식 점검**에서 원본 vs **`clean_score_only.pdf`** PNG 비교, PDF 다운로드, Audiveris 단계별 실행(`pdfSource=clean_score`)을 지원합니다. 단계 의미·디버깅: [docs/Audiveris_단계별_디버깅.md](docs/Audiveris_단계별_디버깅.md).
- **저장 형식 v3**: `lyric_manifest.json` — `items[]`(병합 출처 `provenance`, `fontSize` 등) + `matchStats`. `inject_ocr.py`는 v2/v3 manifest와 flat 배열 모두 읽습니다.
- **한글·ZIP 파일명**: `POST /api/convert` 멀티파트 파일명 디코딩은 그대로 유지합니다.
- 자세한 품질·호환 대응은 [docs/악보_변환_품질_가이드.md](docs/악보_변환_품질_가이드.md), 배포 점검은 동 문서 **「서버 배포 후 점검 체크리스트」**를 따르세요.

## 기능

- **웹 UI**: PDF 파일 선택(복수), **드래그 앤 드롭**(전용 영역), 일괄 변환(순차 처리), 파일별 진행 표·개별 다운로드(실패 행 **결과** 열에는 서버 오류 메시지 전체를 줄바꿈으로 표시)
- **진행 표시**: 업로드 단계와 Audiveris 단계의 진행 상황을 표시합니다(Audiveris 로그 형식에 따라 세부 진행은 제한적일 수 있음).
- **한글 제목·가사(OCR)**: Audiveris는 글자에 Tesseract를 쓰며, **clean_score(악보만) 변환 기본은 `eng`**입니다. PDF에 한글을 Audiveris가 직접 읽게 하려면 **`AUDIVERIS_OCR_LANG=kor+eng`** 등을 설정하세요. `kor.traineddata` 등은 [docs/악보_변환_품질_가이드.md](docs/악보_변환_품질_가이드.md) 「한글 인식 문제」류 절과 아래 환경 변수 표를 참고하세요.
- **고해상도 OCR 및 벡터 PDF 직접 추출**: 검토 UI용 글자·좌표 추출은 예전처럼 항상 300 DPI OCR만 쓰면 서버 부하와 중단 위험이 컸습니다. 현재는 `PyMuPDF`로 **벡터 PDF**에 내장된 글자와 좌표를 우선 빠르게 읽고, 텍스트가 없는 **이미지 PDF**일 때만 300 DPI PaddleOCR로 대체 인식합니다.
- **문자-악보 사전 매핑 및 마스킹 (Pre-Audiveris UI)**: Audiveris 악보 인식 전에 팝업을 띄워 인식된 글자들의 역할을 지정(`제목`, `작사가`, `가사`, **`템포(BPM)`** 등)합니다. 검토 카드에서 **「미리보기」**를 누르면 위 PNG에 해당 줄 **OCR bbox(청록 점선)** 와 귀퉁이 표시가 뜹니다. 귀퉁이·변 근처를 드래그해 bbox를 줄이거나, 안쪽을 드래그해 이동할 수 있습니다(저장된 `bbox`만 갱신하고 **`spans`는 제거**되어 줄 단위 마스킹으로 전환). **추가**로 페이지 빈 공간에서 사각형을 그리면 **수동**(MUSIC SAFE 없음) 지우기 영역이 됩니다(음표·오선 근처는 가능한 좁게). **페이지 미리보기 위에 가사 줄만 추가로 칠해서 지울 영역**(수동 마스킹)과 병행 가능합니다. **템포**로 지정한 영역은 마스킹되고, 검토한 BPM(예: `75`, `♩= 75`)은 `inject_ocr.py`가 첫 마디 MusicXML에 `<sound tempo="…">` 및 metronome으로 넣어 **재생기가 기본 120으로 도는 문제**를 줄입니다. 지정된 영역은 Audiveris에 넘어가기 전 **`mask_pdf.py`** 가 처리합니다. **가사** 블록(선택 리덕 모드 기본 켜짐)은 PyMuPDF로 **복사 가능한 텍스트 글림만** 하나씩 처리하며, `rawdict` 추출에 기본 포함되는 **SIDE_BEARINGS·ASCENDERS**(정확 bbox) 플래그로 과대 글림 bbox를 줄입니다. **`MASK_PDF_GLOBAL_HANGUL_SYLLABLE_BLANK`** 로 페이지 전역 한글 완성형·자모 추가 블랭크가 **기본 켜져** 있습니다(`0`/`false`/`off`로 끔). 리덕의 기본 형태는 **`fill=False` + 공백(또는 `MASK_PDF_LYRIC_REPLACE_CHAR`) 치환**이라 **오선 등 벡터 위에 깔던 흰 리덕 박스**보다 표기가 더 잘 살아남습니다(`MASK_PDF_LYRIC_PLAIN_REDACT=1` 로 예전 흰 fill 리덕 복귀). MuPDF 특성상 **리덕 사각형과 bbox가 겹치는 텍스트**는 지울 수 있어(`set_small_glyph_heights`), **음표·SMuFL 텍스트 글림과 라틴 등 가사 글림이 면적으로 충분히 겹치면**(`MASK_PDF_LYRIC_MUSIC_SAFE` 기본값) 해당 글자만 리덕을 생략합니다. **한글**은 같은 줄 교착 잔류가 생기기 쉬워 **기본으로 이 겹침 검사를 생략**합니다(`MASK_PDF_LYRIC_IGNORE_MUSIC_OVERLAP_FOR_KOREAN`). 교차만으로 예전처럼 생략하려면 `MASK_PDF_LYRIC_MUSIC_LEGACY_INTERSECT=1` 입니다. 생략된 글자는 남습니다. `MASK_PDF_LYRIC_REDACT_PASSES`·최소 리덕 높이(세로 부족 시 **아래로만** 패딩)·**`MASK_PDF_LYRIC_REDACT_MAX_HEIGHT_EM`(기본 1.14)** 로 리덕 세로를 **폰트 크기 근처**까지 줄여 **위·아래 인접 스태프**(윗 성부 가사 bbox가 과대하게 아래 줄 머리까지 내리꽂거나, 역으로 아래 줄이 위로 비대하게 뻗은 경우)와의 교차 손실을 줄입니다. **벡터** 추출 줄에 **`spans`(span별 bbox)** 가 있으면 기본적으로 **그 세그먼트** 좌표에만 블랭크를 거는 경로가 우선됩니다(`MASK_PDF_LYRIC_USE_EXTRACT_SPANS`). 한글만 아래쪽을 더 남기려면 선택적으로 **`MASK_PDF_LYRIC_REDACT_KOREAN_BOTTOM_KEEP_FRAC`**(예: `0.78`)를 줍니다. 전체 가사 영역을 흰 박스로만 덮는 폴백은 `MASK_PDF_LYRIC_WHITE_FALLBACK=1`입니다. 가사 블록을 통째로 흰 박스로만 덮으려면 `MASK_PDF_LYRIC_SELECTIVE=0`입니다. 제목·템포 등 다른 분류는 종전처럼 bbox 전체를 흰 박스(또는 선택 `MASK_PDF_TEXT_REDACT=1`)로 덮습니다. **가사**는 글자별 하이픈(`-`)으로 “이 음표는 가사 없음”을 표시할 수 있으며, MXL에 합칠 때 **파트 순번**, **가사 절**(1절·2절… → `<lyric number>`), **멜로디 줄**(MusicXML `<voice>`, 동시에 울리는 다른 선율용·1절/2절과 **다름**), **`*`**(문서 순 멜로디), **앞쪽 음표 생략**을 지정합니다. 블록 옆 **신뢰도**는 OCR 참고용입니다. 각 항목의 의미는 [docs/악보_변환_품질_가이드.md](docs/악보_변환_품질_가이드.md) 「검토 UI → MusicXML 가사 주입」절에 설명합니다.
- **성부 라벨(S/A/T/B/PR/PL)**: 문자 검토에서 미리 정하거나, Audiveris 직후 MXL part-list와 대조해 확정합니다. 이후 OMR lint·UI에서 **PDF 페이지(p.)** 와 구분되는 성부 이름으로 표시됩니다.
- **Audiveris 직후 OMR 품질 검토(HITL, 기본 켜짐)**: 성부 라벨 확정 후 **`mxl_quality_lint.py`** 로 점검하고, **페이지×성부** UI에서 PDF와 대조한 뒤 **이어하기**로 가사 주입 단계로 넘깁니다. [docs/일반_품질_및_HITL_로드맵.md](docs/일반_품질_및_HITL_로드맵.md).
- **Audiveris 직후 보정**: 「Audiveris 직후 멈춤」을 켜면 **악보 인식 직후** MXL을 받아 MuseScore 등에서 음높이·음표를 확인한 뒤, 웹의 **Audiveris 결과 보정** 모달에서 **조옮김(반음)**·**교체 MXL**을 지정해 이어갈 수 있습니다(글자·가사 역할 검토 단계와는 별개). 조옮김은 **곡 전체가 같은 간격만큼만** 밀린 경우에 해당하고, 일부만 틀리면 편집 후 MXL 교체가 맞습니다. 자세한 설명은 동 문서 「Audiveris 직후 수동 보정」절을 참고하세요.
- **결과 자동 저장**: UI에서 "결과 저장하기"를 체크하면 변환이 완료된 후 별도로 저장 버튼을 누르지 않아도 **자동으로 `.mxl` 파일이 다운로드**됩니다. (이전의 디버그 ZIP 다운로드 기능은 제거되었습니다.)
- **비동기 변환(폴링)**: 변환(Audiveris)은 시간이 오래 걸리므로 **완료 후 곧바로 파일을 응답하지 않습니다.** `POST /api/convert`는 **PDF 수신·저장이 끝난 뒤** **HTTP 202** 와 `jobId`를 돌려주고, 실제 변환은 서버 백그라운드에서 돌아갑니다. 클라이언트는 **상태 API를 주기적으로 조회**한 뒤, 완료 시 **다운로드 API**로 결과를 받습니다. (과거에는 업로드 도중 202를 보내 일부 환경에서 본문 전송이 멈추는 문제가 있어, 202 시점을 저장 완료 후로 옮겼습니다.)
- **결과 보관 기간(TTL)**: 변환이 **완료되었거나 최종 실패로 판정된 시점**부터 **24시간**이 지나면 서버 메모리의 작업 기록과 임시 결과 파일을 자동으로 삭제합니다. **`GET /api/download`로 받은 뒤에도** 같은 `jobId`로 **마스킹·인식 점검**(진단 API·웹 점검 패널)을 쓸 수 있습니다(TTL 전까지). UI와 `GET /api/health` 응답에 동일 안내가 포함됩니다.
- **마스킹·Audiveris 인식 점검 UI**: 변환 완료·실패 행에서 **마스킹·인식 점검**으로, **페이지별** 원본 PDF와 마스킹 PDF를 나란히 PNG로 비교합니다. Audiveris **MusicXML**은 OpenSheetMusicDisplay로 미리보며, **파트(성부)** 단위로 필터해 한 줄씩 보기 쉽게 할 수 있습니다. 같은 패널에서 **Audiveris 단계별 실행**(예: `-step GRID`)으로 로그·`.omr`을 받아 이슈 재현에 쓸 수 있습니다 — 단계별 의미·디버깅 순서는 [docs/Audiveris_단계별_디버깅.md](docs/Audiveris_단계별_디버깅.md). **Audiveris 결과 보정** 모달에서도 **마스킹·인식 점검** 탭을 열 수 있습니다.
- **REST API**: `POST /api/convert`, `GET /api/status/:jobId`, `GET /api/download/:jobId`, 진단용 `GET /api/diagnostic/...`, `GET /api/health` (아래 [REST API (비동기)](#rest-api-비동기) 참고)
- **CLI**: `npm run convert -- <파일.pdf>` → 기본 저장 `~/Downloads`(Linux) 등
- **운영 모드**: `npm run build` 후 `dist`를 Express가 같은 포트에서 서빙 (`npm run start:prod`)

## 필요 조건

- **Node.js** 20+ 권장
- **Python** 3.8+ (PaddleOCR·PyMuPDF·**pdfplumber·pikepdf** 가사 분리·병합·주입 파이프라인용)
- **Audiveris** (호스트에 설치, 아래 환경 변수로 실행 파일 지정)

Python 환경에서 다음 명령어로 의존성을 설치해야 합니다. **폰트 분리(권장) 파이프라인**은 `pikepdf`·`pdfplumber`가 **필수**입니다.

```bash
cd /path/to/pdf2musicxml
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Linux에서 `pikepdf` 설치가 실패하면 QPDF 개발 라이브러리가 필요할 수 있습니다.

```bash
sudo apt-get install -y libqpdf-dev   # Debian/Ubuntu
pip install pikepdf pdfplumber
```
*(참고: 리눅스 환경에서 PDF 이미지 변환 시 `sudo apt-get install poppler-utils`가 필요할 수 있습니다.)*

### Ubuntu에서 Audiveris (예: 24.04)

[GitHub Releases](https://github.com/Audiveris/audiveris/releases)에서 `Audiveris-*-ubuntu24.04-x86_64.deb`(또는 22.04용) 내려받은 뒤:

```bash
sudo apt install -y ./Audiveris-*-ubuntu24.04-x86_64.deb
/opt/audiveris/bin/Audiveris -help
```

## 환경 변수

| 변수 | 설명 |
|------|------|
| `AUDIVERIS_BIN` | **필수**(변환 시). 예: `/opt/audiveris/bin/Audiveris` |
| `AUDIVERIS_OCR_LANG` | Tesseract 언어 사양. **설정 시 이 값이 최우선**(예: `kor+eng`). **미설정**이면 `AUDIVERIS_CLEAN_SCORE_OCR_LANG` 또는 **`eng`**. Audiveris 기본만 쓰려면 빈 값: `AUDIVERIS_OCR_LANG=` |
| `AUDIVERIS_PAUSE_ON_WARN` | `1`/`true`/`yes`이면 Audiveris 표준출력·에러에 `WARN`(또는 `AUDIVERIS_WARN_PATTERN`)이 **한 번이라도** 보이면 **`pauseAfterAudiveris` 없이도** `audiveris_review_needed`로 멈춤(HITL). |
| `AUDIVERIS_WARN_PATTERN` | (선택) Audiveris 로그를 스캔할 정규식. 미설정 시 `\bWARN\b`(대소문자 무시). |
| `TESSDATA_PREFIX` | (선택) Tesseract `tessdata` 폴더. 미설정 시 Audiveris 사용자 설정 쪽 `tessdata` 사용 |
| `PORT` | API/UI 포트 (기본 `8787`) |
| `LISTEN_HOST` | 바인딩 주소 (기본 `0.0.0.0`). `127.0.0.1`만 열려면 nginx 뒤에 둘 때 사용 |
| `AUDIVERIS_NO_FLAT_OUTPUT` | `1`이면 `-option …useSeparateBookFolders=false` 비활성화 |
| `AUDIVERIS_CLI_EXTRA_JSON` | (고급) Audiveris CLI에 추가로 붙일 인자를 **JSON 문자열 배열**로 지정. 예: `["-constant","org.audiveris.omr.sheet.Scale.defaultBeamSpecification=10"]`. 잘못된 JSON은 무시됩니다. `GET /api/health`의 `audiverisCliExtraArgCount`로 개수만 확인. |
| `AUDIVERIS_KEEP_DEFAULT_SWITCHES` | `1`/`true`이면 가사·코드네임 OCR 끄기·피아노 마디선 완화 등 **기본 Audiveris 스위치**를 넣지 않음. |
| `AUDIVERIS_KEEP_TEXT_CONSTANTS` | `1`/`true`이면 `TextWord` tuplet/abnormal regexp 튜닝 상수를 넣지 않음. |
| `AUDIVERIS_CLEAN_SCORE_OCR_LANG` | `AUDIVERIS_OCR_LANG` 미설정 시 Audiveris OCR 언어(기본 **`eng`**). clean_score에 한글 없을 때 세잇단 `3`→`P` OCR 완화. |
| `AUDIVERIS_MXL_FIX` | 기본 켜짐. `0`/`false`이면 `inject_ocr.py` 직전 `fix_audiveris_mxl.py`(잔여 P/2P direction 등) 생략. **SYMBOLS UI에는 영향 없음.** |
| (문서) | SYMBOLS 단계 오인식·Audiveris 소스 패치: [docs/Audiveris_엔진_한계와_대응.md](docs/Audiveris_엔진_한계와_대응.md) |
| `MASK_PDF_TEXT_REDACT` | (선택) `1`/`true`/`yes`일 때 **제목·작곡가 등 비-가사** 구역에 벡터 텍스트가 있으면 **전체 bbox** 텍스트 리독을 시도합니다. **가사**는 기본이 **글자별 선택 리독**(아래)이라 이 옵션과 별개입니다. |
| `MASK_PDF_LYRIC_SELECTIVE` | (선택) `0`/`false`면 끔. **기본(설정 없음)**: 타입 **`lyrics`** 만 가사처럼 보이는 유니코드를 **글리프 단위** 리덕. **`MASK_PDF_LYRIC_MUSIC_SAFE`(기본 켜짐)** 는 **면적 비율**로 음표·SMuFL 텍스트와 실제 겹침이 클 때만 가사 리덕 생략(레거시는 **`MASK_PDF_LYRIC_MUSIC_LEGACY_INTERSECT=1`**). 가사 블록 전체를 흰 사각형으로만 덮으려면 이 옵션을 끕니다. |
| `MASK_PDF_LYRIC_USE_EXTRACT_SPANS` | **기본 켜짐**(`0`/`false`로 끔). 벡터 `extract_text.py`가 `ocr_data.json` 줄마다 넣은 **`spans[].bbox`(PyMuPDF dict span 단위)** 가 있으면, 가사 블록 마스킹 시 **추출한 그 세그먼트 좌표**만 써 블랭크하고(폴백: `spans` 없으면 페이지에서 rawdict 재수집). **이미지 PDF(OCR만)** 줄에는 보통 `spans`가 없음. |
| `MASK_PDF_LYRIC_CHAR_PAD_PT` | (선택) 가사 **리덕 annot** 에만 적용되는 bbox 확장 pt(겹침 판별은 글림의 tight bbox만 사용)(기본 `0`). 과하면 음표 머리까지 건드리므로 0 근처 권장. |
| `MASK_PDF_LYRIC_TEXT_FLAGS` | (선택) `get_text('rawdict')` 에 넣을 **`flags`** 정수 bitmask(hex `0x…` 허용). 미설정 시 **ACCURATE_BBOXES \| SIDE_BEARINGS \| ASCENDERS**(구버전에는 있는 항목만)·편집기 과대 텍스트 Object bbox를 줄이는 목적. |
| `MASK_PDF_LYRIC_MUSIC_SAFE` | (선택) `0`/`false`면 끔. **기본**: 음표·SMuFL **텍스트 글림**과 충분히 겹치는 **비한글·라틴** 가사 글림만 리덕 생략(아래 `MIN_OVERLAP`). **한글(완성형·호환 자모)** 은 같은 줄 SMuFL과 bbox가 과대 겹치는데도 잘리지 않도록 **기본으로 MUSIC 검사 생략**(`MASK_PDF_LYRIC_IGNORE_MUSIC_OVERLAP_FOR_KOREAN` 참고). |
| `MASK_PDF_LYRIC_IGNORE_MUSIC_OVERLAP_FOR_KOREAN` | **기본 적용**(의미 없는 값 또는 생략=켜짐; `0`/`false`/`off` 로 끔). 켠 상태에서 **한글** 가사 글림은 MUSIC_SAFE 검사 없이 블랭크합니다(S·A·T·B 아래 교착 잔류 감소). 끄면 한글도 SMuFL 겹침으로 스킵될 수 있습니다. |
| `MASK_PDF_LYRIC_MUSIC_PAD_PT` | (선택) 음표(SMuFL)·텍스트 글림 bbox를 **겹침 판정용**으로 부풀리는 pt(기본 **`0.12`**; 크면 스킵이 늘어 가사 잔류가 생기기 쉬움). |
| `MASK_PDF_LYRIC_MUSIC_MIN_OVERLAP` | (선택) 겹침 면적 / min(가사·음표면적) 의 최소 비율 기본 **`0.09`** (낮추면 더 적극 블랭크 / 너무 낮추면 머리 손상 / 높이면 스킵으로 잔류). |
| `MASK_PDF_LYRIC_MUSIC_LEGACY_INTERSECT` | `1`이면 **예전처럼** 교차만으로 가사 리덕 생략(`MIN_OVERLAP` 무시). 남은 가사가 많을 때 과거 동작 재현용. |
| `MASK_PDF_LYRIC_REDACT_PASSES` | 기본 **`2`**(범위 1–8). 1차 `apply_redactions` 후 페이지를 다시 읽어 한글 레이어 **잔류·이중 CID** 리덕. |
| `MASK_PDF_LYRIC_REDACT_MIN_HEIGHT_PT` | 선택 가사 **리덕 사각형** 세로 최소 pt(기본 **`0.35`**, `0`=비활성). 부족할 때 **`y1`만 아래로** 늘립니다(**위쪽 패딩 없음**, 음표·온쉼표 SMuFL과의 오겹 리덕 방지). |
| `MASK_PDF_LYRIC_REDACT_MAX_HEIGHT_EM` | 선택 가사 **리덕 rect** 세로 **상한 ≈ 줄 폰트×이 값**(기본 **`1.14`**, **`0`** 또는 음수면 비활성). tight 글림 bbox의 **세로 중앙**에 맞춰 잘라, 위·아래로 과하게 늘어난 rawdict 박스를 **글자 높이에 가깝게** 줄입니다(**MUSIC 겹침 판정에는 tight overlap bbox 유지**). |
| `MASK_PDF_LYRIC_REDACT_KOREAN_BOTTOM_KEEP_FRAC` | **한글** 추가 조정만(선택). **미설정이면 비활성** — 위 `MAX_HEIGHT_EM`만 씁니다. `0` 초과 **`1`** 미만(예 **`0.78`**)으로 리덕 세로에서 **위를 더 덜어내고 아래쪽만** 남깁니다. |
| `MASK_PDF_LYRIC_STAFF_SCAN_PAD_PT` | (선택) 가사 검토 박스 위·아래로 벌려 음표 글림을 찾을 범위 pt(기본 `40`). |
| `MASK_PDF_LYRIC_PLAIN_REDACT` | (선택) `1`이면 선택 **가사** 글림 리덕을 예전처럼 `add_redact_annot(bbox)`만 호출 (**기본 흰색 fill**)해 벡터 오선까지 가릴 수 있음. 디버깅·호환 때만 사용. |
| `MASK_PDF_LYRIC_REPLACE_CHAR` | (선택) 가사 리덕 치환에 넣을 **한 글자**(기본 스페이스). UTF-8로 전각 공백 한 글자를 넣어 너비 유지 등을 시도할 수 있습니다. |
| `MASK_PDF_GLOBAL_HANGUL_SYLLABLE_BLANK` | **기본 켜짐**(`0`/`false`/`off`로 끔). JSON에 문자를 둔 뒤 **페이지 전체**에서 한글 완성형·현대·호환 자모(U+AC00–U+D7A3, U+1100–11FF, U+3131–318E) 텍스트를 추가 블랭크합니다. **`MASK_PDF_LYRIC_SELECTIVE` 기본일 때만** 동작. SMuFL/PUA 제외·`MASK_PDF_LYRIC_MUSIC_SAFE` 규칙은 위 **한글 MUSIC 생략**과 동일합니다. |
| `MASK_PDF_LYRIC_WHITE_FALLBACK` | (선택) `1`이면 가사 블록에서 글립 리덕을 하나도 못 만들 때 **전체 bbox 흰 박스** 폴백(기본 끔; 음표까지 가릴 수 있음). |
| `MASK_PDF_MANUAL_LYRIC_MASK` | **기본 적용**(의미 없는 값 또는 생략=켜짐; `0`/`false`/`off`로 끔). 검토 UI에서 사용자가 표시한 **수동 가사 마스킹 영역**(`ocr_data.json` 의 `type`: `_manual_lyric_mask`, `manualRects`) 안의 텍스트 글림만 선택 리덕합니다. **`MASK_PDF_LYRIC_MUSIC_SAFE`를 적용하지 않습니다**(영역 책임은 사용자). |

품질·호환 이슈(한글 파일명, mxlplayer `realValue`, 마디 수 등)는 [docs/악보_변환_품질_가이드.md](docs/악보_변환_품질_가이드.md)를 참고하세요.

영구 설정 예 (`~/.bashrc`):

```bash
export AUDIVERIS_BIN=/opt/audiveris/bin/Audiveris
# 전역 한글 블랭크는 기본 켜짐. 끄려면: export MASK_PDF_GLOBAL_HANGUL_SYLLABLE_BLANK=0
```

### 서버 배포 요약 (운영)

1. **코드 반영**: `git pull origin main` (또는 배포 브랜치).
2. **의존성**: `npm ci` 또는 `npm install`, 파이썬의 경우 `pip install -r requirements.txt` 실행하여 `PyMuPDF` 등 갱신.
3. **프론트 빌드**: `npm run build` — `start:prod`는 `dist`를 서빙합니다.
4. **환경 변수**: `AUDIVERIS_BIN` — PM2/systemd에 반영 후 **프로세스 재시작**.
5. **동작 확인**: `GET /api/health`, 한글 파일명 PDF + 디버그 ZIP으로 샘플 변환 — 단계별 세부 항목은 [docs/악보_변환_품질_가이드.md](docs/악보_변환_품질_가이드.md).

## 설치·실행

```bash
git clone https://github.com/jjhanx/pdf2musicxml.git
cd pdf2musicxml
npm install
pip install -r requirements.txt
```

### 개발 (Vite HMR + API)

```bash
export AUDIVERIS_BIN=/opt/audiveris/bin/Audiveris
npm run dev
```

- 웹: `http://호스트:5173` (Vite는 `host: true`로 LAN 접속 가능)
- API: `8787`, 프록시 `/api` → `8787`

### 운영 (빌드 + 단일 포트)

```bash
export AUDIVERIS_BIN=/opt/audiveris/bin/Audiveris
npm run start:prod
```

- `http://호스트:8787` — UI + `/api` 동일 포트  
- `dist`가 없으면 API만 동작합니다.

### 백그라운드 운영 (PM2)

서버 재부팅 시 자동 실행 및 안정적인 백그라운드 구동을 위해 `pm2` 사용을 권장합니다.

```bash
# 1. 전역 설치
sudo npm install -g pm2

# 2. 서버 구동 (이름을 pdf2mxl로 지정)
AUDIVERIS_BIN=/opt/audiveris/bin/Audiveris pm2 start npm --name "pdf2mxl" -- run start:prod

# 3. 재부팅 시 자동 실행 등록
pm2 startup
pm2 save

# 로그 확인: pm2 logs pdf2mxl
# 재시작: pm2 restart pdf2mxl
```

### CLI만

```bash
export AUDIVERIS_BIN=/opt/audiveris/bin/Audiveris
npm run convert -- "/path/to/score.pdf"
npm run convert -- "/path/to/score.pdf" -o "/path/to/out/"
```

## REST API (비동기)

모든 엔드포인트는 `application/json` 또는 바이너리(다운로드)로 응답합니다.

| 메서드·경로 | 설명 |
|-------------|------|
| `GET /api/health` | 서버·Audiveris 구성·**OCR 언어**(`audiverisOcrLangEffective`, `audiverisOcrLangConstantInjected`)·**`audiverisCliExtraArgCount`**(`AUDIVERIS_CLI_EXTRA_JSON` 토큰 수)·**`audiverisPauseOnWarn`**, 선택 **`audiverisWarnPattern`**. JSON에 `jobRetentionHours`(기본 `24`), `jobRetentionNote`(한글 안내) 포함 |
| `GET /api/audiveris-sheet-steps` | Audiveris 공식 시트 단계 이름 배열 JSON `{ "steps": [ … ] }` (단계별 디버깅 UI용). 인증 없음 |
| `POST /api/convert` | `multipart/form-data`: 필드 `pdf`, 선택 `debug`, 선택 **`pauseAfterAudiveris`**, 선택 **`pipelineMode`** (`font_separator` \| `pymupdf_review` \| `audiveris_only`, 기본 `font_separator`), **`font_separator`일 때** 선택 **`enablePymupdfReview`** (`true`/`false`, 기본 `true`). **202 Accepted** + `{ "jobId" }`. |
| `GET /api/status/:jobId` | `pending` → `processing` → `review_needed` → (`audiveris_review_needed`) → `completed` \| `failed`. **`Cache-Control: no-store`**. `processing`·`pending` 중일 때 **`progress`**: `phase`(`upload` \| `audiveris`), `current`, `total`, 선택 `detail` |
| `GET /api/review/:jobId` | 상태가 `review_needed`일 때 추출된 문자 영역(좌표/텍스트) 데이터 가져오기 |
| `GET /api/review/:jobId/pdf-dimensions` | `review_needed` 단계만. 업로드 PDF 페이지 크기(pt) JSON(`pdf_diagnostic.py pagesizes`) — 수동 가사 마스킹 좌표 변환 |
| `GET /api/review/:jobId/pdf-page-png/:pageNum` | `review_needed` 단계만. 한 페이지 미리보기 PNG(쿼리 `dpi` 기본 **118**) |
| `POST /api/review/:jobId` | 본문은 **항목 배열**이거나 `{ "items": [...], "transposeSemitones"?: number }` — 마스킹·가사 분류 제출 후 Audiveris 단계 재개. 수동 마스킹은 항목 `type`: `_manual_lyric_mask`, `manualRects`: `[{ "page": 1, "bbox": [x0,y0,x1,y1] }, …]`(PDF pt·PyMuPDF 좌표)로 포함됩니다. `transposeSemitones`는 API·고급용(가사 검토 웹 UI에서는 생략, 0과 동일); 음높이 조정 안내는 「Audiveris 직후 수동 보정」 참고 |
| `GET /api/raw-mxl/:jobId` | `omr_staff_review_needed` 또는 `audiveris_review_needed` 일 때 Audiveris가 만든 **주입 전** MXL 다운로드 |
| `POST /api/continue-audiveris/:jobId` | `audiveris_review_needed` 해제: **`application/json`** `{ "transposeSemitones": number }` 또는 **`multipart/form-data`**: 필드 `transposeSemitones`, 선택 파일 필드명 **`mxl`** (교체 MXL). 이후 OCR·가사 주입 단계 진행 |
| `GET /api/download/:jobId` | `completed` 일 때만 단일 MXL/MusicXML 또는 ZIP 스트림. 완료 전·실패 후는 409. 다운로드 후에도 작업·임시 파일은 **24시간 TTL** 전까지 유지되며, 진단 API·재다운로드 가능 |
| `GET /api/diagnostic/:jobId/summary` | **`completed`**, **`omr_staff_review_needed`**, **`audiveris_review_needed`**, 또는 **`failed`** 일 때. 원본/마스킹 PDF 존재·페이지 수·MusicXML 미리보기 가능 여부 JSON (`Cache-Control: no-store`) |
| `GET /api/diagnostic/:jobId/omr-policy` | job별 OCR·TextWord 상수·P 유발 경로·lint 요약 |
| `GET /api/diagnostic/:jobId/mxl-lint` | Audiveris 직후 MXL lint JSON. `part_labels.json` 저장·갱신 시 캐시를 무효화하고 성부 라벨을 반영합니다. 쿼리 `page`, `staff`(S/A/T/B/PR/PL), 강제 재생성 `regen=1` |
| `GET /api/diagnostic/:jobId/score-parts` | Audiveris MXL part-list + 저장·초안 라벨 |
| `POST /api/part-labels/:jobId` | **`part_labels_needed`** 일 때 `{ "labelsByIndex": ["S","A",…] }` 저장 후 계속 |
| `POST /api/continue-omr-staff-review/:jobId` | **`omr_staff_review_needed`** 일 때 OMR HITL 이어하기 |
| `GET /api/diagnostic/:jobId/page/:pageNum/png` | 쿼리 `source=original` 또는 `masked`, 선택 `dpi`(72–240, 기본 132). PyMuPDF로 해당 페이지 PNG |
| `GET /api/diagnostic/:jobId/score-musicxml` | Audiveris MXL에서 평문 MusicXML(미리보기용). 완료 결과가 ZIP이면 출력 목록 중 첫 `.mxl` 기준 |
| `GET /api/diagnostic/:jobId/masked-pdf` | Audiveris에 넣기 직전 **`masked_input.pdf`** (`application/pdf`). 기본 `inline`(새 탭), `?download=1`이면 다운로드 |
| `GET /api/diagnostic/:jobId/original-pdf` | 세션에 남은 **업로드 원본 PDF**. 동일하게 `?download=1` 지원 |
| `POST /api/diagnostic/:jobId/audiveris-step-probe` | **`completed` / `audiveris_review_needed` / `failed`** 작업만. 본문 JSON: `step`(필수, 예: `GRID`), `force?`, `sheets?`(예: `"1 4-7"`), `pdfSource?`(`clean_score`\|`masked`\|`original`). 서버가 Audiveris `-batch -save -step …`( **`-export` 없음** ) 실행 후 `exitCode`, `stdout`/`stderr`(길면 잘림), `argv`, `artifacts`, `runId` 반환. **단계 설명·사용법:** [docs/Audiveris_단계별_디버깅.md](docs/Audiveris_단계별_디버깅.md) |
| `GET /api/diagnostic/:jobId/audiveris-step-probe/:runId/download` | 위 실행 결과물 다운로드. 쿼리 **`rel`** = 해당 실행 폴더 기준 상대 경로 (예: `piece/book.omr`). 경로 탈출 차단 |

프론트엔드(`src/App.tsx`)는 변환 접수 후 **약 2초 간격**으로 `/api/status/:jobId`를 호출하고, `review_needed`이면 Pre-Audiveris 검토 모달, **`audiveris_review_needed`**이면 Audiveris 결과 보정 모달을 띄웩니다. 제출은 각각 `/api/review/:jobId`, `/api/continue-audiveris/:jobId`로 이어집니다. 완료 행의 **마스킹·인식 점검**은 동일 `jobId`로 진단 API를 사용합니다. **변환 실패** 행에서도 세션이 남아 있으면 동일 버튼으로 점검·**Audiveris 단계별 실행** GUI를 열 수 있습니다.

**참고**: 만료(TTL)로 작업이 삭제된 뒤에는 동일 `jobId`로 상태 조회 시 404가 됩니다.

## 도메인·포트 (DuckDNS 등)

DNS는 **호스트명 → IP**만 제공합니다. `http://도메인`은 **80번**으로 접속합니다.

- **8787만 열고** 접속: `http://도메인:8787`
- **포트 없이** 쓰려면 nginx 등으로 **80 → `127.0.0.1:8787`** 역프록시 후 방화벽·공유기에서 **80** 허용

## mxlplayer 연동

생성된 `.mxl` / `.musicxml` 파일을 PC로 옮긴 뒤, [mxlplayer](https://github.com/jjhanx/mxlplayer)에서 **파일 업로드**로 열면 됩니다.

## 문제 해결 (웹 UI 및 서버)

- **502 Bad Gateway**: nginx가 **업스트림(Node)에 TCP 연결을 못 하거나**, 앱이 **기동 직후 크래시**하면 납니다. 서버에서 `curl -sS http://127.0.0.1:8787/api/health`(포트는 환경에 맞게)로 직접 확인하고, `pm2 logs pdf2mxl` 등으로 **Node/TS 구문 오류·모듈 누락**을 봅니다. `proxy_pass`의 호스트·포트가 실제 리슨과 같은지 확인하세요.
- **진행률이 안 바뀜 / 항상 '변환 중…'만 보임**: 브라우저·역프록시가 **`GET /api/status`를 캐시**하면 JSON이 갱신되지 않을 수 있습니다. 최신 코드는 응답에 `Cache-Control: no-store`를 붙이고, 클라이언트는 `fetch(..., { cache: 'no-store' })`로 폴링합니다. nginx에서 **`proxy_cache`** 를 쓰는 경우 `location /api/` 에 대해 캐시를 끄거나 해당 URI를 제외하세요.
- **504 Gateway Time-out (역프록시 뒤에서 변환/업로드 중 끊김)**  
  - **POST `/api/convert`**: nginx는 백엔드가 **202를 보낼 때까지** 응답을 기다립니다. 이 202는 **파일 업로드·저장이 끝난 뒤** 나가므로, **매우 큰 PDF·느린 업링크**에서는 업로드 시간만큼 `proxy_read_timeout`이 필요할 수 있습니다. 변환 자체는 202 이후 백그라운드에서 돌아가므로 긴 Audiveris 처리는 **상태 폴링**으로 이어집니다.  
  - **다운로드**: `/api/download/...` 로 ZIP 등을 오래 받는 경우에도 프록시 **읽기 타임아웃**에 걸릴 수 있습니다. nginx 예: `proxy_read_timeout 3600s;`, `proxy_send_timeout 3600s;`, 필요 시 `client_max_body_size`(업로드 용량)도 조정하세요.
- **업로드 단계에서 멈춘 것처럼 보임 / 작은 PDF인데 진행이 안 됨**: 과거 **업로드 도중 202**를 보내던 방식은 HTTP 클라이언트·프록시에 따라 **POST 본문 전송이 교착**될 수 있습니다. 최신 코드는 **저장 완료 후 202**입니다. 배포 후 `/api/convert` 응답 헤더에 `X-Pdf2Mxl-Async: 202-after-upload`인지 확인하세요.
- **변환 직후 다음 날 다운로드 링크가 동작하지 않음**: **24시간 TTL**이 지나 작업·파일이 삭제된 경우입니다. 다시 변환하거나, 보관 기간을 늘리려면 서버 코드의 `JOB_RETENTION_MS`를 조정하세요.
- **변환 버튼 클릭 시 아무 반응 없음**: 과거 빌드에서 존재하지 않는 `runBatch()`를 호출하는 버그가 있었습니다. 최신 `main`을 받아 다시 빌드하세요.
- **HTTP(평문) 접속**: `crypto.randomUUID()`는 보안 컨텍스트에서만 안전하게 쓰이므로, 평문 HTTP에서는 대체 ID 생성으로 처리합니다.
- **변환 버튼이 반응 없음(그 외)**: 브라우저별로 드롭 직후 `FileList`가 비는 경우가 있어 `DataTransfer.items` 경로를 추가했습니다. 서버는 정적 파일이 `/api`를 덮지 않도록 정리되어 있습니다.
- **다운로드된 ZIP 파일 이름이 `ë__Â...` 또는 `_@…`처럼 깨지는 현상**: 멀티파트 `filename*` / `filename` 조합과 **Latin-1 오해석**이 겹칠 때 발생할 수 있습니다. 최신 서버는 UTF-8·NFC·한글·대체 문자를 고려해 디코딩합니다. 여전히 깨지면 **브라우저·역프록시가 `Content-Disposition`을 어떻게 전달하는지**(인코딩 헤더 절단 여부)를 확인하세요.

## 프로젝트 구조

```
pdf2musicxml/
├── docs/
│   └── 악보_변환_품질_가이드.md  # 품질·호환·서버 점검 체크리스트 (한글)
├── server/index.ts             # Express API + (있으면) dist 정적 서빙
├── shared/audiveris.ts         # Audiveris CLI 래퍼
├── scripts/
│   ├── extract_text.py         # PyMuPDF 벡터 텍스트 직접 추출 및 OCR 폴백
│   ├── mask_pdf.py             # 마스킹(가사: 글리프 선택 제거 기본·SMuFL 보존 / 기타 bbox 흰 박스·선택 리독)
│   ├── inject_ocr.py           # 검증/매핑된 글자를 MusicXML <lyric> 등에 병합
│   ├── mxl_quality_lint.py     # MXL 품질 lint (P direction, phantom rest, 마디 경계)
│   ├── pdf_diagnostic.py       # 진단 API: 페이지 수·PNG 렌더
│   ├── mxl_to_musicxml_file.py # MXL에서 MusicXML 추출(미리보기)
│   └── convert-cli.ts
├── src/
│   ├── App.tsx
│   └── AudiverisInspectPanel.tsx
└── vite.config.ts
```

## 라이선스

저장소에 별도 명시가 없으면 저장소 소유자 정책을 따릅니다. Audiveris·사용 라이브러리는 각각의 라이선스를 따릅니다.
