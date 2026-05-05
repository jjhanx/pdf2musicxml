# pdf2musicxml (pdf2mxl-audiveris)

PDF 악보를 **Audiveris**로 변환해 **MusicXML(`.mxl` / `.musicxml`)** 로 내려받는 도구입니다.  
프론트는 **Vite + React + TypeScript**, API는 **Express**이며 [mxlplayer](https://github.com/jjhanx/mxlplayer)와 같은 계열의 웹 스택입니다.

## 기능

- **웹 UI**: PDF 파일 선택(복수), **드래그 앤 드롭**(전용 영역), 일괄 변환(순차 처리), 파일별 진행 표·개별 다운로드
- **REST API**: `POST /api/convert`(multipart 필드명 `pdf`), `GET /api/health`
- **CLI**: `npm run convert -- <파일.pdf>` → 기본 저장 `~/Downloads`(Linux) 등
- **운영 모드**: `npm run build` 후 `dist`를 Express가 같은 포트에서 서빙 (`npm run start:prod`)

## 필요 조건

- **Node.js** 20+ 권장
- **Python** 3.8+ (텍스트/가사 추출 및 마스킹 파이프라인용)
- 파이썬 의존성 설치: `pip install -r requirements.txt` (PyMuPDF, lxml)
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

### CLI만

```bash
export AUDIVERIS_BIN=/opt/audiveris/bin/Audiveris
npm run convert -- "/path/to/score.pdf"
npm run convert -- "/path/to/score.pdf" -o "/path/to/out/"
```

## 도메인·포트 (DuckDNS 등)

DNS는 **호스트명 → IP**만 제공합니다. `http://도메인`은 **80번**으로 접속합니다.

- **8787만 열고** 접속: `http://도메인:8787`
- **포트 없이** 쓰려면 nginx 등으로 **80 → `127.0.0.1:8787`** 역프록시 후 방화벽·공유기에서 **80** 허용

## mxlplayer 연동

생성된 `.mxl` / `.musicxml` 파일을 PC로 옮긴 뒤, [mxlplayer](https://github.com/jjhanx/mxlplayer)에서 **파일 업로드**로 열면 됩니다.

## 문제 해결 (웹 UI)

- **변환 버튼 클릭 시 아무 반응 없음**: 과거 빌드에서 존재하지 않는 `runBatch()`를 호출하는 버그가 있었습니다. 최신 `main`을 받아 다시 빌드하세요.
- **HTTP(평문) 접속**: `crypto.randomUUID()`는 보안 컨텍스트에서만 안전하게 쓰이므로, 평문 HTTP에서는 대체 ID 생성으로 처리합니다.
- **변환 버튼이 반응 없음(그 외)**: 브라우저별로 드롭 직후 `FileList`가 비는 경우가 있어 `DataTransfer.items` 경로를 추가했습니다. 서버는 정적 파일이 `/api`를 덮지 않도록 정리되어 있습니다.

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
