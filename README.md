# pdf2musicxml (pdf2mxl-audiveris)

PDF 악보를 **Audiveris**로 변환해 **MusicXML(`.mxl` / `.musicxml`)** 로 내려받는 도구입니다.  
프론트는 **Vite + React + TypeScript**, API는 **Express**이며 [mxlplayer](https://github.com/jjhanx/mxlplayer)와 같은 계열의 웹 스택입니다.

## 기능

- **웹 UI**: PDF 파일 선택(복수), **드래그 앤 드롭**(전용 영역), 일괄 변환(순차 처리), 파일별 진행 표·개별 다운로드
- **한글 파일명 지원**: 변환된 파일 다운로드 시 원본 파일의 한글 이름이 깨지지 않고 온전하게 보존됩니다.
- **디버그 모드**: UI에서 "중간 과정 파일 함께 다운로드 (디버그 모드, ZIP)"를 체크하면 마스킹된 PDF, 텍스트 데이터 JSON, 병합 전후의 MXL 등 모든 중간 산출물을 ZIP으로 묶어서 받을 수 있어 과정 추적이 용이합니다.
- **비동기 변환(폴링)**: Nginx·Cloudflare 등 앞단 프록시의 **게이트웨이 타임아웃(예: 504)** 을 피하기 위해, **`POST /api/convert`는 multipart 본문(파일 업로드)이 끝나기 전에** **HTTP 202** 와 `jobId`를 먼저 내려보냅니다. 업로드·저장은 같은 연결에서 이어지고, 변환은 서버 백그라운드에서 진행됩니다. 클라이언트는 **상태 API를 주기적으로 조회**한 뒤, 완료 시 **다운로드 API**로 결과를 받습니다.
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

영구 설정 예 (`~/.bashrc`):

```bash
export AUDIVERIS_BIN=/opt/audiveris/bin/Audiveris
```

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
| `POST /api/convert` | `multipart/form-data`: 필드 `pdf`(파일), `debug`(`true`/`false`, 선택). **요청 본문을 다 받기 전에** **202 Accepted** 와 `{ "jobId", "message" }`를 먼저 반환합니다. 응답 헤더에 `X-Pdf2Mxl-Async: 202-early`(확인용), nginx 앞일 때 버퍼 끄기용 `X-Accel-Buffering: no`가 붙을 수 있습니다. 업로드·검증 실패 시 작업 상태가 `failed`로 남습니다. |
| `GET /api/status/:jobId` | `pending` → `processing` → `completed` \| `failed`. 실패 시 본문에 `error`, `detail`, `stderrTail` 등 포함(조회 응답은 200). 없는 ID는 404 |
| `GET /api/download/:jobId` | `completed` 일 때만 단일 MXL/MusicXML 또는 ZIP 스트림. 완료 전·실패 후는 409. 전송 종료 후 서버가 해당 작업의 임시 디렉터리 정리 |

프론트엔드(`src/App.tsx`)는 변환 접수 후 **약 3초 간격**으로 `/api/status/:jobId`를 호출하고, 완료되면 `/api/download/:jobId`로 Blob을 받아 저장 링크를 제공합니다.

**참고**: 만료(TTL)로 작업이 삭제된 뒤에는 동일 `jobId`로 상태 조회 시 404가 됩니다.

## 도메인·포트 (DuckDNS 등)

DNS는 **호스트명 → IP**만 제공합니다. `http://도메인`은 **80번**으로 접속합니다.

- **8787만 열고** 접속: `http://도메인:8787`
- **포트 없이** 쓰려면 nginx 등으로 **80 → `127.0.0.1:8787`** 역프록시 후 방화벽·공유기에서 **80** 허용

## mxlplayer 연동

생성된 `.mxl` / `.musicxml` 파일을 PC로 옮긴 뒤, [mxlplayer](https://github.com/jjhanx/mxlplayer)에서 **파일 업로드**로 열면 됩니다.

## 문제 해결 (웹 UI 및 서버)

- **504 Gateway Time-out (역프록시 뒤에서 변환/업로드 중 끊김)**  
  - **조기 202**: 예전에는 `multer`가 파일 전체를 디스크에 저장한 뒤에만 응답할 수 있어, **업로드가 길면** nginx `proxy_read_timeout` 전에 백엔드 응답이 없어 504가 날 수 있었습니다. 현재는 **`busboy`로 스트리밍 수신**하면서 **먼저 202**를 보냅니다. 배포 후 네트워크 탭에서 `/api/convert`가 본문 전송 중에도 **202**인지, `X-Pdf2Mxl-Async: 202-early` 헤더가 있는지 확인하세요.  
  - **다운로드**: `/api/download/...` 로 ZIP 등을 오래 받는 경우에도 프록시 **읽기 타임아웃**에 걸릴 수 있습니다. nginx 예: `proxy_read_timeout 3600s;`, `proxy_send_timeout 3600s;`, 필요 시 `client_max_body_size`(업로드 용량)도 조정하세요.
- **변환 직후 다음 날 다운로드 링크가 동작하지 않음**: **24시간 TTL**이 지나 작업·파일이 삭제된 경우입니다. 다시 변환하거나, 보관 기간을 늘리려면 서버 코드의 `JOB_RETENTION_MS`를 조정하세요.
- **변환 버튼 클릭 시 아무 반응 없음**: 과거 빌드에서 존재하지 않는 `runBatch()`를 호출하는 버그가 있었습니다. 최신 `main`을 받아 다시 빌드하세요.
- **HTTP(평문) 접속**: `crypto.randomUUID()`는 보안 컨텍스트에서만 안전하게 쓰이므로, 평문 HTTP에서는 대체 ID 생성으로 처리합니다.
- **변환 버튼이 반응 없음(그 외)**: 브라우저별로 드롭 직후 `FileList`가 비는 경우가 있어 `DataTransfer.items` 경로를 추가했습니다. 서버는 정적 파일이 `/api`를 덮지 않도록 정리되어 있습니다.
- **다운로드된 ZIP 파일 이름이 `ë__Â...` 같은 외계어로 깨지는 현상**: 멀티파트에서 온 파일명이 **Latin-1로 잘못 인코딩**되어 들어오는 경우가 있습니다. 서버는 **UTF-8로 되돌려** 안전한 파일명으로 저장·응답합니다.
- **디버그 모드의 `text_data.json`이 빈 배열 `[]`이고 마스킹이 안 되는 현상**: `easyocr`이 100MB 가량의 AI 모델을 처음 다운로드할 때 터미널에 출력하는 진행률 바가 Node.js `exec()`의 기본 버퍼 크기(1MB)를 초과하여 파이썬 스크립트가 강제 종료(Crash)되면서 발생하는 문제입니다. 최신 코드에서는 허용 버퍼를 늘리고 강제로 UTF-8 인코딩 환경 변수를 주입하여 해결했습니다.
  - **주의**: 패치 적용 전에 스크립트가 강제 종료되어 **모델 파일이 손상된 상태로 남아있는 경우** 계속해서 똑같이 실패할 수 있습니다. 이 경우 사용자 폴더 하위의 `~/.EasyOCR/model` 폴더를 통째로 삭제한 뒤, 변환을 다시 실행하여 모델이 처음부터 온전하게 다운로드 되도록 해야 합니다.

## 프로젝트 구조

```
pdf2musicxml/
├── server/index.ts             # Express API + (있으면) dist 정적 서빙
├── shared/audiveris.ts         # Audiveris CLI 래퍼
├── scripts/
│   ├── convert-cli.ts
│   ├── pdf_text_extractor.py   # PDF 텍스트 추출 및 마스킹
│   └── mxl_text_merger.py      # Audiveris 출력물에 텍스트(가사 등) 병합
├── src/App.tsx                 # UI (다중 파일·드래그 앤 드롭)
└── vite.config.ts
```

## 라이선스

저장소에 별도 명시가 없으면 저장소 소유자 정책을 따릅니다. Audiveris·사용 라이브러리는 각각의 라이선스를 따릅니다.
