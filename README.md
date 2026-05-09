# pdf2musicxml (pdf2mxl-audiveris)

PDF 악보를 **Audiveris**로 변환해 **MusicXML(`.mxl` / `.musicxml`)** 로 내려받는 도구입니다.  
프론트는 **Vite + React + TypeScript**, API는 **Express**이며 [mxlplayer](https://github.com/jjhanx/mxlplayer)와 같은 계열의 웹 스택입니다.

- **Audiveris MXL 없음(HTTP 422)**: 마스킹 PDF만으로는 `.mxl`이 안 나오는데 원본은 될 수 있어, 기본적으로 **원본 PDF 자동 재시도**(`PDF2MXL_AUDIVERIS_FALLBACK_ORIGINAL`)를 둡니다. 로그에 `WARN [masked_input#10]`·`ERS`가 보이면 10번째 **악보 장(sheet)** 처리 문제인 경우가 많습니다.

## 최근 변경 (벡터 우선 마스킹·가사·파일명)

- **PDF 텍스트 마스킹** (`scripts/pdf_text_extractor.py`): 벡터 PDF는 **PyMuPDF로 글리프/span 좌표를 먼저 추출·마스킹**하고, EasyOCR은 보완용으로만 사용합니다. OCR 박스가 벡터 텍스트 영역과 많이 겹치면 무시합니다.
- **페이지별 OCR 생략**: `PDF2MXL_VECTOR_OCR_SKIP_THRESHOLD`(기본 `40`) — 페이지당 벡터로 읽힌 글자 수가 이 이상이면 해당 페이지는 EasyOCR을 건너뜁니다.
- **가사 병합** (`scripts/mxl_text_merger.py`): **기본은 안전 모드** — Audiveris MXL 본문은 건드리지 않고 **`*_merged_lyrics.txt` 사이드카**만 둡니다. 예전처럼 MusicXML에 `direction`/`words`를 대량 삽입하려면 `PDF2MXL_INJECT_LYRICS_DIRECTIONS=1`.
- **한글·ZIP 파일명**: `POST /api/convert` 멀티파트 파일명 디코딩을 보강해 `_�@…` 형태의 깨짐을 줄였습니다.
- **Audiveris 재시도**: 마스킹 PDF에서 `.mxl`이 하나도 없으면, 기본 설정으로 **원본 PDF에 대해 Audiveris를 한 번 더** 실행합니다(`PDF2MXL_AUDIVERIS_FALLBACK_ORIGINAL=0`으로 끔).
- 자세한 품질·호환 대응 [docs/악보_변환_품질_가이드.md](docs/악보_변환_품질_가이드.md), **서버에서 무엇을 어떻게 점검할지**는 동 문서의 **「서버 배포 후 점검 체크리스트」**를 따르세요.

## 기능

- **웹 UI**: PDF 파일 선택(복수), **드래그 앤 드롭**(전용 영역), 일괄 변환(순차 처리), 파일별 진행 표·개별 다운로드
- **진행 표시**: OCR 단계에서는 PDF **페이지 단위**(예: 3/10)로 진행률을 내보냅니다. Audiveris·가사 병합 단계에서도 단계명과 처리 중인 항목 번호를 표시합니다(로그 형식에 따라 Audiveris 세부 진행은 제한적일 수 있음).
- **한글 파일명 지원**: 변환된 파일 다운로드 시 원본 파일의 한글 이름이 깨지지 않고 온전하게 보존됩니다.
- **디버그 모드**: UI에서 "중간 과정 파일 함께 다운로드 (디버그 모드, ZIP)"를 체크하면 마스킹된 PDF, 텍스트 데이터 JSON, 병합 전후의 MXL 등 모든 중간 산출물을 ZIP으로 묶어서 받을 수 있어 과정 추적이 용이합니다.
- **비동기 변환(폴링)**: 변환(OCR·Audiveris 등)은 시간이 오래 걸리므로 **완료 후 곧바로 파일을 응답하지 않습니다.** `POST /api/convert`는 **PDF 수신·저장이 끝난 뒤** **HTTP 202** 와 `jobId`를 돌려주고, 실제 변환은 서버 백그라운드에서 돌아갑니다. 클라이언트는 **상태 API를 주기적으로 조회**한 뒤, 완료 시 **다운로드 API**로 결과를 받습니다. (과거에는 업로드 도중 202를 보내 일부 환경에서 본문 전송이 멈추는 문제가 있어, 202 시점을 저장 완료 후로 옮겼습니다.)
- **결과 보관 기간(TTL)**: 변환이 **완료되었거나 최종 실패로 판정된 시점**부터 **24시간**이 지나면 서버 메모리의 작업 기록과, 아직 남아 있던 임시 결과 파일을 자동으로 삭제합니다. UI와 `GET /api/health` 응답에 동일 안내가 포함됩니다.
- **REST API**: `POST /api/convert`, `GET /api/status/:jobId`, `GET /api/download/:jobId`, `GET /api/health` (아래 [REST API (비동기)](#rest-api-비동기) 참고)
- **CLI**: `npm run convert -- <파일.pdf>` → 기본 저장 `~/Downloads`(Linux) 등
- **운영 모드**: `npm run build` 후 `dist`를 Express가 같은 포트에서 서빙 (`npm run start:prod`)

## 필요 조건

- **Node.js** 20+ 권장
- **Python** 3.8+ (텍스트/가사 추출 및 마스킹 파이프라인용)
- 파이썬 의존성 설치: `pip install -r requirements.txt` (PyMuPDF, lxml, easyocr, numpy)
  - **Ubuntu 24.04+ 서버 환경 설정 (필수)**: 최근 우분투 버전에서는 시스템 보호를 위해 전역 `pip` 설치가 막혀 있습니다. 따라서 파이썬 가상환경(venv)을 생성하고 필요한 패키지(`easyocr` 등)와 OS 의존성 패키지를 설치해야 합니다.
    ```bash
    sudo apt-get update
    sudo apt-get install -y libgl1 libglib2.0-0 python3-venv
    
    # 가상환경 생성 및 의존성 설치
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
    
    # 서버 환경변수에 적용 (서버가 가상환경의 파이썬을 사용하도록 설정)
    export PYTHON_BIN=$(pwd)/venv/bin/python
    ```
- **Audiveris** (호스트에 설치, 아래 환경 변수로 실행 파일 지정)

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
| `PORT` | API/UI 포트 (기본 `8787`) |
| `LISTEN_HOST` | 바인딩 주소 (기본 `0.0.0.0`). `127.0.0.1`만 열려면 nginx 뒤에 둘 때 사용 |
| `AUDIVERIS_NO_FLAT_OUTPUT` | `1`이면 `-option …useSeparateBookFolders=false` 비활성화 |
| `PDF2MXL_VECTOR_OCR_SKIP_THRESHOLD` | 페이지당 **벡터 추출 글자 수**가 이 값 **이상**이면 해당 페이지 **EasyOCR 생략**(기본 `40`). 가사가 잘 안 지워지면 낮출 것(예: `20`). |
| `PDF2MXL_INJECT_LYRICS_DIRECTIONS` | `1`이면 **구버전**: 병합 MXL 첫 마디에 `direction`/`words` 대량 삽입. **기본(미설정)**: MXL은 원본 유지, 가사는 **`*_merged_lyrics.txt`** 사이드카만 생성. |
| `PDF2MXL_AUDIVERIS_FALLBACK_ORIGINAL` | 마스킹 PDF로 Audiveris를 돌렸는데 **.mxl/.musicxml이 하나도 없을 때** 같은 작업에서 **업로드 원본 PDF로 한 번 더** Audiveris를 실행합니다. 끄려면 `0` 또는 `false`(기본: 재시도 허용). |

품질·호환 이슈(한글 파일명, mxlplayer `realValue`, 마디 수 등)는 [docs/악보_변환_품질_가이드.md](docs/악보_변환_품질_가이드.md)를 참고하세요.

영구 설정 예 (`~/.bashrc`):

```bash
export AUDIVERIS_BIN=/opt/audiveris/bin/Audiveris
# (선택) 벡터 OCR 임계값·가사 주입 — 가이드 문서 참고
# export PDF2MXL_VECTOR_OCR_SKIP_THRESHOLD=30
# export PDF2MXL_INJECT_LYRICS_DIRECTIONS=1
```

### 서버 배포 요약 (운영)

1. **코드 반영**: `git pull origin main` (또는 배포 브랜치).
2. **의존성**: `npm ci` 또는 `npm install`, Python venv에서 `pip install -r requirements.txt` (변경 시).
3. **프론트 빌드**: `npm run build` — `start:prod`는 `dist`를 서빙합니다.
4. **환경 변수**: `AUDIVERIS_BIN`, `PYTHON_BIN`(venv 권장), 필요 시 `PDF2MXL_*` — PM2/systemd에 반영 후 **프로세스 재시작**.
5. **동작 확인**: `GET /api/health`, 한글 파일명 PDF + 디버그 ZIP으로 샘플 변환 — 단계별 세부 항목은 [docs/악보_변환_품질_가이드.md](docs/악보_변환_품질_가이드.md).

## 설치·실행

```bash
git clone https://github.com/jjhanx/pdf2musicxml.git
cd pdf2musicxml
npm install
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
| `GET /api/health` | 서버·Audiveris 구성 여부. JSON에 `jobRetentionHours`(기본 `24`), `jobRetentionNote`(한글 안내) 포함 |
| `POST /api/convert` | `multipart/form-data`: 필드 `pdf`, 선택 `debug`. **파일이 디스크에 저장된 뒤** **202 Accepted** 와 `{ "jobId", "message" }`. 헤더 `X-Pdf2Mxl-Async: 202-after-upload`, `X-Accel-Buffering: no`. 업로드·multipart 오류 시 **동일 POST**에서 4xx/5xx JSON(이 경우 `jobId` 없음). |
| `GET /api/status/:jobId` | `pending` → `processing` → `completed` \| `failed`. **`Cache-Control: no-store`**. `processing`·`pending` 중일 때 **`progress`**: `phase`(`upload` \| `ocr` \| `audiveris` \| `merge`), `current`, `total`, 선택 `detail` |
| `GET /api/download/:jobId` | `completed` 일 때만 단일 MXL/MusicXML 또는 ZIP 스트림. 완료 전·실패 후는 409. 전송 종료 후 서버가 해당 작업의 임시 디렉터리 정리 |

프론트엔드(`src/App.tsx`)는 변환 접수 후 **약 2초 간격**으로 `/api/status/:jobId`를 호출하고, **`progress`가 있으면** 테이블에 단계명·`current/total`·진행 막대를 표시합니다. 완료되면 `/api/download/:jobId`로 Blob을 받아 저장 링크를 제공합니다.

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
  - **POST `/api/convert`**: nginx는 백엔드가 **202를 보낼 때까지** 응답을 기다립니다. 이 202는 **파일 업로드·저장이 끝난 뒤** 나가므로, **매우 큰 PDF·느린 업링크**에서는 업로드 시간만큼 `proxy_read_timeout`이 필요할 수 있습니다. 변환 자체는 202 이후 백그라운드에서 돌아가므로 긴 OCR은 **상태 폴링**으로 이어집니다.  
  - **다운로드**: `/api/download/...` 로 ZIP 등을 오래 받는 경우에도 프록시 **읽기 타임아웃**에 걸릴 수 있습니다. nginx 예: `proxy_read_timeout 3600s;`, `proxy_send_timeout 3600s;`, 필요 시 `client_max_body_size`(업로드 용량)도 조정하세요.
- **업로드 단계에서 멈춘 것처럼 보임 / 작은 PDF인데 진행이 안 됨**: 과거 **업로드 도중 202**를 보내던 방식은 HTTP 클라이언트·프록시에 따라 **POST 본문 전송이 교착**될 수 있습니다. 최신 코드는 **저장 완료 후 202**입니다. 배포 후 `/api/convert` 응답 헤더에 `X-Pdf2Mxl-Async: 202-after-upload`인지 확인하세요.
- **변환 직후 다음 날 다운로드 링크가 동작하지 않음**: **24시간 TTL**이 지나 작업·파일이 삭제된 경우입니다. 다시 변환하거나, 보관 기간을 늘리려면 서버 코드의 `JOB_RETENTION_MS`를 조정하세요.
- **변환 버튼 클릭 시 아무 반응 없음**: 과거 빌드에서 존재하지 않는 `runBatch()`를 호출하는 버그가 있었습니다. 최신 `main`을 받아 다시 빌드하세요.
- **HTTP(평문) 접속**: `crypto.randomUUID()`는 보안 컨텍스트에서만 안전하게 쓰이므로, 평문 HTTP에서는 대체 ID 생성으로 처리합니다.
- **변환 버튼이 반응 없음(그 외)**: 브라우저별로 드롭 직후 `FileList`가 비는 경우가 있어 `DataTransfer.items` 경로를 추가했습니다. 서버는 정적 파일이 `/api`를 덮지 않도록 정리되어 있습니다.
- **다운로드된 ZIP 파일 이름이 `ë__Â...` 또는 `_�@…`처럼 깨지는 현상**: 멀티파트 `filename*` / `filename` 조합과 **Latin-1 오해석**이 겹칠 때 발생할 수 있습니다. 최신 서버는 UTF-8·NFC·한글·대체 문자를 고려해 디코딩합니다. 여전히 깨지면 **브라우저·역프록시가 `Content-Disposition`을 어떻게 전달하는지**(인코딩 헤더 절단 여부)를 확인하세요.
- **디버그 모드의 `text_data.json`이 빈 배열 `[]`이고 마스킹이 안 되는 현상**: `easyocr`이 100MB 가량의 AI 모델을 처음 다운로드할 때 터미널에 출력하는 진행률 바가 Node.js `exec()`의 기본 버퍼 크기(1MB)를 초과하여 파이썬 스크립트가 강제 종료(Crash)되면서 발생하는 문제입니다. 최신 코드에서는 허용 버퍼를 늘리고 강제로 UTF-8 인코딩 환경 변수를 주입하여 해결했습니다.
  - **주의**: 패치 적용 전에 스크립트가 강제 종료되어 **모델 파일이 손상된 상태로 남아있는 경우** 계속해서 똑같이 실패할 수 있습니다. 이 경우 사용자 폴더 하위의 `~/.EasyOCR/model` 폴더를 통째로 삭제한 뒤, 변환을 다시 실행하여 모델이 처음부터 온전하게 다운로드 되도록 해야 합니다.

## 프로젝트 구조

```
pdf2musicxml/
├── docs/
│   └── 악보_변환_품질_가이드.md  # 품질·호환·서버 점검 체크리스트 (한글)
├── server/index.ts             # Express API + (있으면) dist 정적 서빙
├── shared/audiveris.ts         # Audiveris CLI 래퍼
├── scripts/
│   ├── convert-cli.ts
│   ├── pdf_text_extractor.py   # 벡터 우선 + 선택적 OCR 마스킹
│   └── mxl_text_merger.py      # 가사 사이드카(기본) / 선택적 MXL 주입
├── src/App.tsx                 # UI (다중 파일·드래그 앤 드롭)
└── vite.config.ts
```

## 라이선스

저장소에 별도 명시가 없으면 저장소 소유자 정책을 따릅니다. Audiveris·사용 라이브러리는 각각의 라이선스를 따릅니다.
