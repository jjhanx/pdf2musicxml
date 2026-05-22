# pdf2musicxml (pdf2mxl-audiveris)

PDF 악보를 **Audiveris**로 변환해 **MusicXML(`.mxl` / `.musicxml`)** 로 내려받는 도구입니다.  
프론트는 **Vite + React + TypeScript**, API는 **Express**이며 [mxlplayer](https://github.com/jjhanx/mxlplayer)와 같은 계열의 웹 스택입니다.

- **Audiveris MXL 없음(HTTP 422)**: 출력 폴더에 `.mxl`/`.musicxml`이 없을 때입니다. 로그에 `Can't connect to X11`·`java.awt.AWTError`가 보이면 **헤드리스 Linux**에서 `DISPLAY`만 잡혀 Audiveris가 GUI 초기화에 실패한 경우입니다. 앱은 Audiveris 실행 시 `JAVA_TOOL_OPTIONS`에 `-Djava.awt.headless=true`를 붙이도록 되어 있으며, 그래도 안 되면 `unset DISPLAY` 후 PM2 재시작을 검토하세요. 로그에 `WARN [#10]`·`ERS`가 보이면 **10번째 악보 장(sheet)** 처리 문제인 경우가 많습니다. 동일 PDF를 Audiveris GUI로 열어 해당 장을 확인하세요.

## 최근 변경 (Audiveris 단일 파이프라인)

- **PDF 선행 처리 제거**: OCR·텍스트 마스킹·Python 가사 병합을 없애고, 업로드 PDF를 **바로 Audiveris**에 넘깁니다. 가사·글자는 Audiveris가 MusicXML에 넣을 수 있는 범위에서만 포함됩니다.
- **한글·ZIP 파일명**: `POST /api/convert` 멀티파트 파일명 디코딩은 그대로 유지합니다.
- 자세한 품질·호환 대응은 [docs/악보_변환_품질_가이드.md](docs/악보_변환_품질_가이드.md), 배포 점검은 동 문서 **「서버 배포 후 점검 체크리스트」**를 따르세요.

## 기능

- **웹 UI**: PDF 파일 선택(복수), **드래그 앤 드롭**(전용 영역), 일괄 변환(순차 처리), 파일별 진행 표·개별 다운로드
- **진행 표시**: 업로드 단계와 Audiveris 단계의 진행 상황을 표시합니다(Audiveris 로그 형식에 따라 세부 진행은 제한적일 수 있음).
- **한글 제목·가사(OCR)**: Audiveris는 글자에 Tesseract를 쓰며 **기본이 영어(`eng`)**라 한글 처리 시 **`AUDIVERIS_OCR_LANG`**(기본 `kor+eng`) 등을 맞춥니다. `kor.traineddata` 등은 [docs/악보_변환_품질_가이드.md](docs/악보_변환_품질_가이드.md) 「한글 인식 문제」류 절과 아래 환경 변수 표를 참고하세요.
- **고해상도 OCR 및 벡터 PDF 직접 추출**: 검토 UI용 글자·좌표 추출은 예전처럼 항상 300 DPI OCR만 쓰면 서버 부하와 중단 위험이 컸습니다. 현재는 `PyMuPDF`로 **벡터 PDF**에 내장된 글자와 좌표를 우선 빠르게 읽고, 텍스트가 없는 **이미지 PDF**일 때만 300 DPI PaddleOCR로 대체 인식합니다.
- **문자-악보 사전 매핑 및 마스킹 (Pre-Audiveris UI)**: Audiveris 악보 인식 전에 팝업을 띄워 인식된 글자들의 역할을 지정(`제목`, `작사가`, `가사`, **`템포(BPM)`** 등)합니다. **템포**로 지정한 영역은 마스킹되고, 검토한 BPM(예: `75`, `♩= 75`)은 `inject_ocr.py`가 첫 마디 MusicXML에 `<sound tempo="…">` 및 metronome으로 넣어 **재생기가 기본 120으로 도는 문제**를 줄입니다. 지정된 영역은 Audiveris에 넘어가기 전 **`mask_pdf.py`** 가 처리합니다. **가사** 블록(선택 리덕 모드 기본 켜짐)은 PyMuPDF로 **복사 가능한 텍스트 글림만** 하나씩 처리하며, 기본값은 **`fill=False` + 공백(또는 `MASK_PDF_LYRIC_REPLACE_CHAR`) 치환**이라 **오선 등 벡터 위에 깔던 흰 리덕 박스**보다 표기가 더 잘 살아남습니다(`MASK_PDF_LYRIC_PLAIN_REDACT=1` 로 예전 흰 fill 리덕 복귀). MuPDF 특성상 **리덕 사각형과 bbox가 겹치는 텍스트**는 지울 수 있어(`set_small_glyph_heights`), **음표·SMuFL 텍스트 글림 bbox와 만나면 가사 한 글자 리덕을 생략**합니다(생략된 글자는 남음). 전체 가사 영역을 흰 박스로만 덮는 폴백은 `MASK_PDF_LYRIC_WHITE_FALLBACK=1`입니다. 가사 블록을 통째로 흰 박스로만 덮으려면 `MASK_PDF_LYRIC_SELECTIVE=0`입니다. 제목·템포 등 다른 분류는 종전처럼 bbox 전체를 흰 박스(또는 선택 `MASK_PDF_TEXT_REDACT=1`)로 덮습니다. **가사**는 글자별 하이픈(`-`)으로 “이 음표는 가사 없음”을 표시할 수 있으며, MXL에 합칠 때 **파트 순번**, **가사 절**(1절·2절… → `<lyric number>`), **멜로디 줄**(MusicXML `<voice>`, 동시에 울리는 다른 선율용·1절/2절과 **다름**), **`*`**(문서 순 멜로디), **앞쪽 음표 생략**을 지정합니다. 블록 옆 **신뢰도**는 OCR 참고용입니다. 각 항목의 의미는 [docs/악보_변환_품질_가이드.md](docs/악보_변환_품질_가이드.md) 「검토 UI → MusicXML 가사 주입」절에 설명합니다.
- **Audiveris 직후 보정**: 「Audiveris 직후 멈춤」을 켜면 **악보 인식 직후** MXL을 받아 MuseScore 등에서 음높이·음표를 확인한 뒤, 웹의 **Audiveris 결과 보정** 모달에서 **조옮김(반음)**·**교체 MXL**을 지정해 이어갈 수 있습니다(글자·가사 역할 검토 단계와는 별개). 조옮김은 **곡 전체가 같은 간격만큼만** 밀린 경우에 해당하고, 일부만 틀리면 편집 후 MXL 교체가 맞습니다. 자세한 설명은 동 문서 「Audiveris 직후 수동 보정」절을 참고하세요.
- **결과 자동 저장**: UI에서 "결과 저장하기"를 체크하면 변환이 완료된 후 별도로 저장 버튼을 누르지 않아도 **자동으로 `.mxl` 파일이 다운로드**됩니다. (이전의 디버그 ZIP 다운로드 기능은 제거되었습니다.)
- **비동기 변환(폴링)**: 변환(Audiveris)은 시간이 오래 걸리므로 **완료 후 곧바로 파일을 응답하지 않습니다.** `POST /api/convert`는 **PDF 수신·저장이 끝난 뒤** **HTTP 202** 와 `jobId`를 돌려주고, 실제 변환은 서버 백그라운드에서 돌아갑니다. 클라이언트는 **상태 API를 주기적으로 조회**한 뒤, 완료 시 **다운로드 API**로 결과를 받습니다. (과거에는 업로드 도중 202를 보내 일부 환경에서 본문 전송이 멈추는 문제가 있어, 202 시점을 저장 완료 후로 옮겼습니다.)
- **결과 보관 기간(TTL)**: 변환이 **완료되었거나 최종 실패로 판정된 시점**부터 **24시간**이 지나면 서버 메모리의 작업 기록과 임시 결과 파일을 자동으로 삭제합니다. **`GET /api/download`로 받은 뒤에도** 같은 `jobId`로 **마스킹·인식 점검**(진단 API·웹 점검 패널)을 쓸 수 있습니다(TTL 전까지). UI와 `GET /api/health` 응답에 동일 안내가 포함됩니다.
- **마스킹·Audiveris 인식 점검 UI**: 변환 완료·실패 행에서 **마스킹·인식 점검**으로, **페이지별** 원본 PDF와 마스킹 PDF를 나란히 PNG로 비교합니다. Audiveris **MusicXML**은 OpenSheetMusicDisplay로 미리보며, **파트(성부)** 단위로 필터해 한 줄씩 보기 쉽게 할 수 있습니다. 같은 패널에서 **Audiveris 단계별 실행**(예: `-step GRID`)으로 로그·`.omr`을 받아 이슈 재현에 쓸 수 있습니다. **Audiveris 결과 보정** 모달에서도 **마스킹·인식 점검** 탭을 열 수 있습니다.
- **REST API**: `POST /api/convert`, `GET /api/status/:jobId`, `GET /api/download/:jobId`, 진단용 `GET /api/diagnostic/...`, `GET /api/health` (아래 [REST API (비동기)](#rest-api-비동기) 참고)
- **CLI**: `npm run convert -- <파일.pdf>` → 기본 저장 `~/Downloads`(Linux) 등
- **운영 모드**: `npm run build` 후 `dist`를 Express가 같은 포트에서 서빙 (`npm run start:prod`)

## 필요 조건

- **Node.js** 20+ 권장
- **Python** 3.8+ (PaddleOCR 가사 추출 및 조표 후처리, PyMuPDF 벡터 추출 파이프라인용)
- **Audiveris** (호스트에 설치, 아래 환경 변수로 실행 파일 지정)

Python 환경에서 다음 명령어로 의존성을 설치해야 완전한 후처리 기능을 사용할 수 있습니다.
```bash
pip install -r requirements.txt
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
| `AUDIVERIS_OCR_LANG` | Tesseract 언어 사양. **미설정 시 `kor+eng`**(한글 가사·제목 + 라틴). Audiveris 기본(보통 영어만)을 쓰려면 빈 값: `AUDIVERIS_OCR_LANG=` |
| `AUDIVERIS_PAUSE_ON_WARN` | `1`/`true`/`yes`이면 Audiveris 표준출력·에러에 `WARN`(또는 `AUDIVERIS_WARN_PATTERN`)이 **한 번이라도** 보이면 **`pauseAfterAudiveris` 없이도** `audiveris_review_needed`로 멈춤(HITL). |
| `AUDIVERIS_WARN_PATTERN` | (선택) Audiveris 로그를 스캔할 정규식. 미설정 시 `\bWARN\b`(대소문자 무시). |
| `TESSDATA_PREFIX` | (선택) Tesseract `tessdata` 폴더. 미설정 시 Audiveris 사용자 설정 쪽 `tessdata` 사용 |
| `PORT` | API/UI 포트 (기본 `8787`) |
| `LISTEN_HOST` | 바인딩 주소 (기본 `0.0.0.0`). `127.0.0.1`만 열려면 nginx 뒤에 둘 때 사용 |
| `AUDIVERIS_NO_FLAT_OUTPUT` | `1`이면 `-option …useSeparateBookFolders=false` 비활성화 |
| `AUDIVERIS_CLI_EXTRA_JSON` | (고급) Audiveris CLI에 추가로 붙일 인자를 **JSON 문자열 배열**로 지정. 예: `["-constant","org.audiveris.omr.sheet.Scale.defaultBeamSpecification=10"]`. 잘못된 JSON은 무시됩니다. `GET /api/health`의 `audiverisCliExtraArgCount`로 개수만 확인. |
| `MASK_PDF_TEXT_REDACT` | (선택) `1`/`true`/`yes`일 때 **제목·작곡가 등 비-가사** 구역에 벡터 텍스트가 있으면 **전체 bbox** 텍스트 리독을 시도합니다. **가사**는 기본이 **글자별 선택 리독**(아래)이라 이 옵션과 별개입니다. |
| `MASK_PDF_LYRIC_SELECTIVE` | (선택) `0`/`false`면 끔. **기본(설정 없음)**: 타입 **`lyrics`** 만 가사처럼 보이는 유니코드를 **글리프 단위** 리덕. 아래 **`MASK_PDF_LYRIC_MUSIC_SAFE`(기본 켜짐)** 가 음표·SMuFL **텍스트 글림 bbox** 와 만나는 가사 리덕은 생략합니다. 가사 블록을 통째로 흰 사각형으로만 덮으려면 이 옵션을 끕니다. |
| `MASK_PDF_LYRIC_CHAR_PAD_PT` | (선택) 가사 후보 글림 리덕 bbox 확장 pt(기본 `0`; 겹치면 줄이거나 `MASK_PDF_LYRIC_MUSIC_SAFE` 확인). |
| `MASK_PDF_LYRIC_MUSIC_SAFE` | (선택) `0`/`false`면 끔. **기본**: 음표·SMuFL **텍스트 글림 bbox**와 겹치는 가사 리덕은 하지 않음(음표가 같이 지워지는 경우 완화). |
| `MASK_PDF_LYRIC_MUSIC_PAD_PT` | (선택) 음표 글림 bbox를 겹침 판정할 때 양쪽으로 부풀리는 pt(기본 `0.35`). |
| `MASK_PDF_LYRIC_STAFF_SCAN_PAD_PT` | (선택) 가사 검토 박스 위·아래로 벌려 음표 글림을 찾을 범위 pt(기본 `40`). |
| `MASK_PDF_LYRIC_PLAIN_REDACT` | (선택) `1`이면 선택 **가사** 글림 리덕을 예전처럼 `add_redact_annot(bbox)`만 호출 (**기본 흰색 fill**)해 벡터 오선까지 가릴 수 있음. 디버깅·호환 때만 사용. |
| `MASK_PDF_LYRIC_REPLACE_CHAR` | (선택) 가사 리덕 치환에 넣을 **한 글자**(기본 스페이스). UTF-8로 전각 공백 한 글자를 넣어 너비 유지 등을 시도할 수 있습니다. |
| `MASK_PDF_LYRIC_WHITE_FALLBACK` | (선택) `1`이면 가사 블록에서 글립 리덕을 하나도 못 만들 때 **전체 bbox 흰 박스** 폴백(기본 끔; 음표까지 가릴 수 있음). |

품질·호환 이슈(한글 파일명, mxlplayer `realValue`, 마디 수 등)는 [docs/악보_변환_품질_가이드.md](docs/악보_변환_품질_가이드.md)를 참고하세요.

영구 설정 예 (`~/.bashrc`):

```bash
export AUDIVERIS_BIN=/opt/audiveris/bin/Audiveris
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
| `POST /api/convert` | `multipart/form-data`: 필드 `pdf`, 선택 `debug`, 선택 **`pauseAfterAudiveris`** (`true`면 Audiveris MXL 생성 직후 파이프라인 일시 정지). **파일이 디스크에 저장된 뒤** **202 Accepted** 와 `{ "jobId", "message" }`. 헤더 `X-Pdf2Mxl-Async: 202-after-upload`, `X-Accel-Buffering: no`. 업로드·multipart 오류 시 **동일 POST**에서 4xx/5xx JSON(이 경우 `jobId` 없음). |
| `GET /api/status/:jobId` | `pending` → `processing` → `review_needed` → (`audiveris_review_needed`) → `completed` \| `failed`. **`Cache-Control: no-store`**. `processing`·`pending` 중일 때 **`progress`**: `phase`(`upload` \| `audiveris`), `current`, `total`, 선택 `detail` |
| `GET /api/review/:jobId` | 상태가 `review_needed`일 때 추출된 문자 영역(좌표/텍스트) 데이터 가져오기 |
| `POST /api/review/:jobId` | 본문은 **항목 배열**이거나 `{ "items": [...], "transposeSemitones"?: number }` — 마스킹·가사 분류 제출 후 Audiveris 단계 재개. `transposeSemitones`는 API·고급용(가사 검토 웹 UI에서는 생략, 0과 동일); 음높이 조정 안내는 「Audiveris 직후 수동 보정」 참고 |
| `GET /api/raw-mxl/:jobId` | `audiveris_review_needed` 일 때 Audiveris가 만든 **주입 전** MXL 다운로드 |
| `POST /api/continue-audiveris/:jobId` | `audiveris_review_needed` 해제: **`application/json`** `{ "transposeSemitones": number }` 또는 **`multipart/form-data`**: 필드 `transposeSemitones`, 선택 파일 필드명 **`mxl`** (교체 MXL). 이후 OCR·가사 주입 단계 진행 |
| `GET /api/download/:jobId` | `completed` 일 때만 단일 MXL/MusicXML 또는 ZIP 스트림. 완료 전·실패 후는 409. 다운로드 후에도 작업·임시 파일은 **24시간 TTL** 전까지 유지되며, 진단 API·재다운로드 가능 |
| `GET /api/diagnostic/:jobId/summary` | **`completed`**, **`audiveris_review_needed`**, 또는 **`failed`** 일 때. 원본/마스킹 PDF 존재·페이지 수·MusicXML 미리보기 가능 여부 JSON (`Cache-Control: no-store`) |
| `GET /api/diagnostic/:jobId/page/:pageNum/png` | 쿼리 `source=original` 또는 `masked`, 선택 `dpi`(72–240, 기본 132). PyMuPDF로 해당 페이지 PNG |
| `GET /api/diagnostic/:jobId/score-musicxml` | Audiveris MXL에서 평문 MusicXML(미리보기용). 완료 결과가 ZIP이면 출력 목록 중 첫 `.mxl` 기준 |
| `GET /api/diagnostic/:jobId/masked-pdf` | Audiveris에 넣기 직전 **`masked_input.pdf`** (`application/pdf`). 기본 `inline`(새 탭), `?download=1`이면 다운로드 |
| `GET /api/diagnostic/:jobId/original-pdf` | 세션에 남은 **업로드 원본 PDF**. 동일하게 `?download=1` 지원 |
| `POST /api/diagnostic/:jobId/audiveris-step-probe` | **`completed` / `audiveris_review_needed` / `failed`** 작업만. 본문 JSON: `step`(필수, 예: `GRID`), `force?`, `sheets?`(예: `"1 4-7"`), `pdfSource?`(`masked`\|`original`). 서버가 Audiveris `-batch -save -step …`( **`-export` 없음** ) 실행 후 `exitCode`, `stdout`/`stderr`(길면 잘림), `argv`, `artifacts`(생성 파일 상대 경로·크기), `runId` 반환. 서버 부하가 크므로 필요 시만 호출 |
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
