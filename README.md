# pdf2musicxml (pdf2mxl-audiveris)

PDF 악보를 **Audiveris**로 변환해 **MusicXML(`.mxl` / `.musicxml`)** 로 내려받는 도구입니다.  
프론트는 **Vite + React + TypeScript**, API는 **Express**이며 [mxlplayer](https://github.com/jjhanx/mxlplayer)와 같은 계열의 웹 스택입니다.

- **Audiveris MXL 없음(HTTP 422)**: 출력 폴더에 `.mxl`/`.musicxml`이 없을 때입니다. 로그에 `WARN [#10]`·`ERS`가 보이면 **10번째 악보 장(sheet)** 처리 문제인 경우가 많습니다. 동일 PDF를 Audiveris GUI로 열어 해당 장을 확인하세요.

## 최근 변경 (Audiveris 단일 파이프라인)

- **PDF 선행 처리 제거**: OCR·텍스트 마스킹·Python 가사 병합을 없애고, 업로드 PDF를 **바로 Audiveris**에 넘깁니다. 가사·글자는 Audiveris가 MusicXML에 넣을 수 있는 범위에서만 포함됩니다.
- **한글·ZIP 파일명**: `POST /api/convert` 멀티파트 파일명 디코딩은 그대로 유지합니다.
- 자세한 품질·호환 대응은 [docs/악보_변환_품질_가이드.md](docs/악보_변환_품질_가이드.md), 배포 점검은 동 문서 **「서버 배포 후 점검 체크리스트」**를 따르세요.

## 기능

- **웹 UI**: PDF 파일 선택(복수), **드래그 앤 드롭**(전용 영역), 일괄 변환(순차 처리), 파일별 진행 표·개별 다운로드
- **진행 표시**: 업로드 단계와 Audiveris 단계의 진행 상황을 표시합니다(Audiveris 로그 형식에 따라 세부 진행은 제한적일 수 있음).
- **한글 제목·가사(OCR)**: Audiveris는 글자에 Tesseract를 쓰며 **기본이 영어(`eng`)**라 한글이 비거나 제목이 "Untitled Score"로 남을 수 있습니다. 서버는 **기본으로 `kor+eng`** OCR 언어를 넘깁니다. Audiveris **Tools → Languages**에서 **Korean(`kor`)** 데이터를 설치하고, `GET /api/health`의 `audiverisOcrLangEffective`로 설정을 확인하세요.
- **한글 파일명 지원**: 변환된 파일 다운로드 시 원본 파일의 한글 이름이 깨지지 않고 온전하게 보존됩니다.
- **악보 후처리 (조표 및 한글 가사 보정)**: Audiveris가 놓친 페이지/단 변경 시의 조표 누락을 자동으로 복원하며, 인식률이 높은 **PaddleOCR**을 파이썬 백그라운드로 실행해 추출된 정확한 한글 텍스트로 가사와 제목을 일괄 교체합니다.
- **한글 가사 인식 검증 (Human-in-the-loop)**: PaddleOCR 결과 중 신뢰도가 낮은 글자가 발견되면 서버가 임시 대기 상태로 전환되며 웹 UI에서 **"글자 인식 확인"** 창이 나타납니다. 사용자가 원본 악보 이미지와 인식 결과를 대조하고 교정하여 변환 품질을 극대화할 수 있습니다. **(팁: 만약 인식 칸조차 생성되지 않고 완전히 누락된 글자가 있다면, 앞이나 뒤의 글자 칸에 이어서 적어넣으면 자동으로 이어서 병합됩니다.)**
- **고해상도 OCR 최적화**: 작은 크기의 악보 가사 및 기호도 빠짐없이 인식할 수 있도록 내부적으로 300 DPI 렌더링 및 해상도 제한 해제(`det_limit_side_len=2560`)를 적용하여 누락률을 크게 낮췄습니다.
- **결과 자동 저장**: UI에서 "결과 저장하기"를 체크하면 변환이 완료된 후 별도로 저장 버튼을 누르지 않아도 **자동으로 `.mxl` 파일이 다운로드**됩니다. (이전의 디버그 ZIP 다운로드 기능은 제거되었습니다.)
- **비동기 변환(폴링)**: 변환(Audiveris)은 시간이 오래 걸리므로 **완료 후 곧바로 파일을 응답하지 않습니다.** `POST /api/convert`는 **PDF 수신·저장이 끝난 뒤** **HTTP 202** 와 `jobId`를 돌려주고, 실제 변환은 서버 백그라운드에서 돌아갑니다. 클라이언트는 **상태 API를 주기적으로 조회**한 뒤, 완료 시 **다운로드 API**로 결과를 받습니다. (과거에는 업로드 도중 202를 보내 일부 환경에서 본문 전송이 멈추는 문제가 있어, 202 시점을 저장 완료 후로 옮겼습니다.)
- **결과 보관 기간(TTL)**: 변환이 **완료되었거나 최종 실패로 판정된 시점**부터 **24시간**이 지나면 서버 메모리의 작업 기록과, 아직 남아 있던 임시 결과 파일을 자동으로 삭제합니다. UI와 `GET /api/health` 응답에 동일 안내가 포함됩니다.
- **REST API**: `POST /api/convert`, `GET /api/status/:jobId`, `GET /api/download/:jobId`, `GET /api/health` (아래 [REST API (비동기)](#rest-api-비동기) 참고)
- **CLI**: `npm run convert -- <파일.pdf>` → 기본 저장 `~/Downloads`(Linux) 등
- **운영 모드**: `npm run build` 후 `dist`를 Express가 같은 포트에서 서빙 (`npm run start:prod`)

## 필요 조건

- **Node.js** 20+ 권장
- **Python** 3.8+ (PaddleOCR 가사 추출 및 조표 후처리 파이프라인용)
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
| `TESSDATA_PREFIX` | (선택) Tesseract `tessdata` 폴더. 미설정 시 Audiveris 사용자 설정 쪽 `tessdata` 사용 |
| `PORT` | API/UI 포트 (기본 `8787`) |
| `LISTEN_HOST` | 바인딩 주소 (기본 `0.0.0.0`). `127.0.0.1`만 열려면 nginx 뒤에 둘 때 사용 |
| `AUDIVERIS_NO_FLAT_OUTPUT` | `1`이면 `-option …useSeparateBookFolders=false` 비활성화 |

품질·호환 이슈(한글 파일명, mxlplayer `realValue`, 마디 수 등)는 [docs/악보_변환_품질_가이드.md](docs/악보_변환_품질_가이드.md)를 참고하세요.

영구 설정 예 (`~/.bashrc`):

```bash
export AUDIVERIS_BIN=/opt/audiveris/bin/Audiveris
```

### 서버 배포 요약 (운영)

1. **코드 반영**: `git pull origin main` (또는 배포 브랜치).
2. **의존성**: `npm ci` 또는 `npm install`.
3. **프론트 빌드**: `npm run build` — `start:prod`는 `dist`를 서빙합니다.
4. **환경 변수**: `AUDIVERIS_BIN` — PM2/systemd에 반영 후 **프로세스 재시작**.
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
| `GET /api/health` | 서버·Audiveris 구성·**OCR 언어**(`audiverisOcrLangEffective`, `audiverisOcrLangConstantInjected`). JSON에 `jobRetentionHours`(기본 `24`), `jobRetentionNote`(한글 안내) 포함 |
| `POST /api/convert` | `multipart/form-data`: 필드 `pdf`, 선택 `debug`. **파일이 디스크에 저장된 뒤** **202 Accepted** 와 `{ "jobId", "message" }`. 헤더 `X-Pdf2Mxl-Async: 202-after-upload`, `X-Accel-Buffering: no`. 업로드·multipart 오류 시 **동일 POST**에서 4xx/5xx JSON(이 경우 `jobId` 없음). |
| `GET /api/status/:jobId` | `pending` → `processing` → `completed` \| `failed`. **`Cache-Control: no-store`**. `processing`·`pending` 중일 때 **`progress`**: `phase`(`upload` \| `audiveris`), `current`, `total`, 선택 `detail` |
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
  - **POST `/api/convert`**: nginx는 백엔드가 **202를 보낼 때까지** 응답을 기다립니다. 이 202는 **파일 업로드·저장이 끝난 뒤** 나가므로, **매우 큰 PDF·느린 업링크**에서는 업로드 시간만큼 `proxy_read_timeout`이 필요할 수 있습니다. 변환 자체는 202 이후 백그라운드에서 돌아가므로 긴 Audiveris 처리는 **상태 폴링**으로 이어집니다.  
  - **다운로드**: `/api/download/...` 로 ZIP 등을 오래 받는 경우에도 프록시 **읽기 타임아웃**에 걸릴 수 있습니다. nginx 예: `proxy_read_timeout 3600s;`, `proxy_send_timeout 3600s;`, 필요 시 `client_max_body_size`(업로드 용량)도 조정하세요.
- **업로드 단계에서 멈춘 것처럼 보임 / 작은 PDF인데 진행이 안 됨**: 과거 **업로드 도중 202**를 보내던 방식은 HTTP 클라이언트·프록시에 따라 **POST 본문 전송이 교착**될 수 있습니다. 최신 코드는 **저장 완료 후 202**입니다. 배포 후 `/api/convert` 응답 헤더에 `X-Pdf2Mxl-Async: 202-after-upload`인지 확인하세요.
- **변환 직후 다음 날 다운로드 링크가 동작하지 않음**: **24시간 TTL**이 지나 작업·파일이 삭제된 경우입니다. 다시 변환하거나, 보관 기간을 늘리려면 서버 코드의 `JOB_RETENTION_MS`를 조정하세요.
- **변환 버튼 클릭 시 아무 반응 없음**: 과거 빌드에서 존재하지 않는 `runBatch()`를 호출하는 버그가 있었습니다. 최신 `main`을 받아 다시 빌드하세요.
- **HTTP(평문) 접속**: `crypto.randomUUID()`는 보안 컨텍스트에서만 안전하게 쓰이므로, 평문 HTTP에서는 대체 ID 생성으로 처리합니다.
- **변환 버튼이 반응 없음(그 외)**: 브라우저별로 드롭 직후 `FileList`가 비는 경우가 있어 `DataTransfer.items` 경로를 추가했습니다. 서버는 정적 파일이 `/api`를 덮지 않도록 정리되어 있습니다.
- **다운로드된 ZIP 파일 이름이 `ë__Â...` 또는 `_�@…`처럼 깨지는 현상**: 멀티파트 `filename*` / `filename` 조합과 **Latin-1 오해석**이 겹칠 때 발생할 수 있습니다. 최신 서버는 UTF-8·NFC·한글·대체 문자를 고려해 디코딩합니다. 여전히 깨지면 **브라우저·역프록시가 `Content-Disposition`을 어떻게 전달하는지**(인코딩 헤더 절단 여부)를 확인하세요.
## 프로젝트 구조

```
pdf2musicxml/
├── docs/
│   └── 악보_변환_품질_가이드.md  # 품질·호환·서버 점검 체크리스트 (한글)
├── server/index.ts             # Express API + (있으면) dist 정적 서빙
├── shared/audiveris.ts         # Audiveris CLI 래퍼
├── scripts/
│   ├── extract_ocr.py          # OCR 글자 추출 및 신뢰도 분석
│   ├── inject_ocr.py           # 검증된 글자를 MusicXML에 병합
│   └── convert-cli.ts
├── src/App.tsx                 # UI (다중 파일·드래그 앤 드롭)
└── vite.config.ts
```

## 라이선스

저장소에 별도 명시가 없으면 저장소 소유자 정책을 따릅니다. Audiveris·사용 라이브러리는 각각의 라이선스를 따릅니다.
