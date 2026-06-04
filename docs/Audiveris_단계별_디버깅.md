# Audiveris 단계별 실행 (디버깅)

웹 **마스킹·인식 점검** 패널 안의 **「Audiveris 단계별 실행 (디버깅)」** 섹션과 `POST /api/diagnostic/:jobId/audiveris-step-probe` API가 하는 일, Audiveris 시트 파이프라인 각 단계의 의미, 권장 사용법을 정리합니다.

공식 CLI 정의: [Audiveris Command line interface](https://audiveris.github.io/audiveris/_pages/guides/advanced/cli/) · 시트 단계 목록: `GET /api/audiveris-sheet-steps`

---

## 일반 변환과의 차이

| | 일반 변환 | 단계별 디버깅 |
|---|-----------|----------------|
| CLI | `-batch -export` | `-batch -save -step <이름>` |
| 결과 | MusicXML(`.mxl`) | **중간 `.omr`·로그** 위주 (`-export` 없음) |
| 목적 | 최종 악보 파일 | **어느 인식 단계에서 깨지는지** 재현 |

서버는 요청마다 세션 폴더 `audiveris-step-probes/<runId>/`에 출력을 두고, UI에서 `stdout`/`stderr`·생성 파일 목록·다운로드 링크를 보여 줍니다.

**사용 가능 job 상태:** `completed`, `audiveris_review_needed`, `failed` (세션·PDF가 TTL 전까지 남아 있을 때). `review_needed`(Pre-Audiveris 검토만 된 상태)에서는 아직 Audiveris가 돌지 않았으므로 이 기능을 쓰지 않습니다.

---

## CLI·API 동작 요약

### `-step`의 의미

선택한 단계 **까지** 앞 단계를 **순서대로 모두** 실행합니다.

예: `-step GRID` → `LOAD` → `BINARY` → `SCALE` → `GRID`까지.

### 기타 옵션 (UI·API와 대응)

| 옵션 | UI / API | 설명 |
|------|----------|------|
| `-save` | (항상 사용) | 단계가 성공할 때마다 `.omr` 등 중간 결과 저장 |
| `-force` | 체크박스 `force` | 이미 목표 단계에 도달했어도 **BINARY부터** 다시 처리 |
| `-sheets` | `sheets` 문자열 | `1`, `3`, `4-7` — 처리할 쪽 번호(공백 구분, `4-7`은 **한 토큰**) |
| 입력 PDF | `pdfSource` | `clean_score` \| `masked` \| `original` — 없으면 clean → masked → 원본 순 폴백 |
| `-export` | **없음** | MXL은 생성하지 않음 |

### API 예시

```http
POST /api/diagnostic/:jobId/audiveris-step-probe
Content-Type: application/json

{
  "step": "GRID",
  "force": false,
  "sheets": "1",
  "pdfSource": "clean_score"
}
```

응답: `runId`, `exitCode`, `stdout`, `stderr`, `argv`, `pdfUsed`, `artifacts[]`, 선택 `note`.

파일 다운로드: `GET /api/diagnostic/:jobId/audiveris-step-probe/:runId/download?rel=<상대경로>`

### 서버 환경

일반 변환과 같이 `AUDIVERIS_BIN`, 선택 `AUDIVERIS_OCR_LANG`(기본 `kor+eng`), `AUDIVERIS_CLI_EXTRA_JSON` 등이 step-probe에도 적용됩니다.

---

## 시트 단계 순서 (전체)

```
LOAD → BINARY → SCALE → GRID → HEADERS → STEM_SEEDS → BEAMS → LEDGERS
  → HEADS → STEMS → REDUCTION → CUE_BEAMS → TEXTS → MEASURES → CHORDS
  → CURVES → SYMBOLS → LINKS → RHYTHMS → PAGE
```

```mermaid
flowchart LR
  LOAD --> BINARY --> SCALE --> GRID --> HEADERS
  HEADERS --> STEM_SEEDS --> BEAMS --> LEDGERS --> HEADS
  HEADS --> STEMS --> REDUCTION --> CUE_BEAMS --> TEXTS
  TEXTS --> MEASURES --> CHORDS --> CURVES --> SYMBOLS
  SYMBOLS --> LINKS --> RHYTHMS --> PAGE
```

---

## 권장 디버깅 순서

문제 유형에 따라 **단계를 점진적으로 올리며** 실행하고, 각 실행의 `exitCode`·로그·`.omr`을 비교합니다. 서버 부하가 크므로 필요할 때만, 가능하면 `-sheets`로 쪽 수를 줄이세요.

| 증상 | 먼저 볼 단계 |
|------|----------------|
| 오선·시스템이 안 잡힘 | `SCALE` → `GRID` |
| 박자·조표·박자표 이상 | `GRID` → `HEADERS` → `MEASURES` |
| 음표 머리·줄기·빔 누락/겹침 | `HEADS` → `STEMS` → `BEAMS` → `REDUCTION` |
| 가사·텍스트가 Audiveris에 다시 잡힘 | `TEXTS` + **입력 PDF**에 글자가 남았는지(원본 vs `clean_score` PNG) |
| 슬러·헤어핀·반복 | `CURVES` → `SYMBOLS` → `LINKS` |
| 최종 MXL만 이상 | `PAGE`까지 probe 후, 동일 PDF로 **전체 변환**(`-export`) 결과와 비교 |

**폰트 분리 파이프라인**에서는 Audiveris 입력이 `clean_score_only.pdf`입니다. 점검 패널에서 `pdfSource=clean_score`(기본)로 두고, [악보_변환_품질_가이드.md](악보_변환_품질_가이드.md)의 마스킹·점검 절과 함께 보세요.

---

## 각 단계 상세

아래는 Audiveris 공식 CLI `-help`의 시트 단계 설명을 바탕으로, **한 장(시트) 이미지를 악보 구조로 읽어 들이는 순서**로 풀어 쓴 것입니다.

### LOAD

- **하는 일:** PDF/이미지 페이지를 **그레이스케일 악보 그림**으로 불러옵니다.
- **의미:** 이후 모든 기하·인식의 입력 픽셀을 만듭니다.
- **실패 시:** 파일 손상, 해상도·회전, 빈 페이지 등을 의심합니다.

### BINARY

- **하는 일:** 그레이 이미지를 **흑백(이진) 이미지**로 만듭니다.
- **의미:** 오선·음표를 선/점으로 구분하기 위한 전처리입니다.
- **실패 시:** 스캔이 너무 연하거나, 배경·워터마크·**가사·제목 잔상**이 이진화를 망가뜨리는 경우가 많습니다. `-force`는 여기부터 다시 시작합니다.

### SCALE

- **하는 일:** **오선 간격(interline)**, **줄기 두께**, **빔 두께** 등 스케일 파라미터를 추정합니다.
- **의미:** 이후 “몇 pt 크기인가” 판단의 기준입니다. SCALE이 틀리면 GRID·음표 인식이 연쇄적으로 어긋납니다.
- **실패 시:** 오선이 거의 없거나, 제목·큰 글자·테두리가 오선처럼 잡히는 경우(clean_score에서 메타 텍스트를 지우지 않은 경우 포함).

### GRID

- **하는 일:** **오선(staff lines)**, **세로 마디선(barlines)**, **시스템·파트(systems & parts)** 를 찾습니다.
- **의미:** 악보의 **뼈대 격자**를 확정하는 핵심 단계입니다. UI 기본 선택이 `GRID`인 이유도 여기서 자주 막히기 때문입니다.
- **실패 시:** 다성부 겹침, 오선 없는 페이지, 마스킹·strip으로 오선이 끊긴 경우.

### HEADERS

- **하는 일:** 각 시스템 앞의 **조표·조성·박자표(Clef–Key–Time)** 블록을 읽습니다.
- **의미:** 음높이·박자 해석의 출발점입니다.

### STEM_SEEDS

- **하는 일:** **줄기 두께**와 줄기 후보 **씨드(seed)** 를 수집합니다.
- **의미:** HEADS/STEMS/BEAMS가 줄기를 안정적으로 이어 붙이게 합니다.

### BEAMS

- **하는 일:** **빔**(여러 음을 잇는 가로 막대)을 검출합니다.
- **의미:** 8분·16분음표 그룹의 리듬 단서입니다.

### LEDGERS

- **하는 일:** 오선 밖 **덧줄(ledger lines)** 을 찾습니다.
- **의미:** 높은/낮은 음의 머리 위치 보정에 필요합니다.

### HEADS

- **하는 일:** **음표 머리(note heads)** 를 검출합니다.
- **의미:** 음높이·길이의 기본 단위입니다.

### STEMS

- **하는 일:** 머리·빔과 연결된 **줄기(stems)** 를 검출합니다.
- **의미:** 음표 방향·복수 줄기·화음 구조의 기초입니다.

### REDUCTION

- **하는 일:** 머리·줄기·빔 사이 **충돌·중복 후보를 정리(reduction)** 합니다.
- **의미:** 같은 위치에 여러 후보가 겹칠 때 하나로 줄입니다.

### CUE_BEAMS

- **하는 일:** **큐빔(cue beams)** — 작은 악보·큐 노트용 짧은 빔을 따로 처리합니다.

### TEXTS

- **하는 일:** 악보 위 **문자 영역에 OCR(Tesseract)** 을 돌립니다.
- **의미:** 가사·템포 숫자·지시어 등이 **입력 PDF에 남아 있으면** 여기서 다시 글자로 잡힙니다.
- **이 저장소와의 관계:** 가사·제목·작곡 등은 보통 PDF에서 지운 뒤 `inject_ocr.py`로 MusicXML에 넣습니다. `clean_score_only.pdf`에 한글이 남으면 TEXTS·최종 MXL 모두에 영향을 줄 수 있습니다.
- **합창+피아노(S/A/T/B·PR/PL):** MuseScore SMuFL **성부 약어**(약 22.8pt, x≤76pt)만 `strip`이 제거합니다. **음자리표**는 같은 pt·x≥79pt라 보존됩니다.

### MEASURES

- **하는 일:** 마디선 묶음으로 **마디(measure) 경계**를 잡습니다.
- **의미:** 박자·마디 번호·리듬 해석의 틀입니다.

### CHORDS

- **하는 일:** 음표 머리들을 **화음/동시음(chords)** 으로 묶습니다.

### CURVES

- **하는 일:** **슬러·크레센도/데크레센도(wedge)·반복선(ending)** 같은 곡선 기호를 찾습니다.

### SYMBOLS

- **하는 일:** **고정 형태 기호**(쉼표, 붙임줄, 강약, 장식음 기호 등)를 분류합니다.

### LINKS

- **하는 일:** 기호·음표·곡선을 **서로 연결(link)** 하고 중복·모순을 줄입니다.
- **의미:** “이 슬러는 이 두 음표”, “이 붙임줄은 이 마디” 같은 관계를 확정합니다.

### RHYTHMS

- **하는 일:** 마디 안에서 **리듬(음 길이·박자 분할)** 을 정리합니다.
- **의미:** MusicXML의 duration·beam 그룹과 직결됩니다.

### PAGE

- **하는 일:** 한 페이지 안 여러 **시스템을 페이지 단위로 연결**해 전체 구조를 마무리합니다.
- **의미:** `-step PAGE`까지 가면 **시트 인식 파이프라인**은 끝에 가깝습니다. 단, **step-probe만으로는 MXL이 생성되지 않습니다** — MXL은 `-export`가 있는 전체 변환에서 나옵니다.

---

## UI에서 결과 해석하기

- **종료 코드:** `0`이 아니면 해당 단계 또는 그 이전에서 예외·인식 실패.
- **사용 PDF:** `pdfUsed`가 요청(`pdfRequested`)과 다르면 `note`에 폴백 사유가 있습니다.
- **생성 파일:** `.omr`, 로그 등 — GitHub 이슈·Audiveris GUI로 열어 중간 상태 확인.
- **stdout / stderr:** `WARN`이 많으면 전체 변환 시 `AUDIVERIS_PAUSE_ON_WARN`으로 **Audiveris 결과 보정** 단계로 넘어갈 수 있습니다.

**마스킹·인식 점검**의 PNG/MusicXML 미리보기는 **이미 끝난(또는 보정 대기) job의 결과**를 보여 줍니다. 단계별 실행은 그와 **별도 실험**으로, “같은 PDF로 GRID까지만 돌려 보기” 같은 **원인 분리**용입니다.

---

## 관련 문서·API

- [악보_변환_품질_가이드.md](악보_변환_품질_가이드.md) — 마스킹·점검, clean_score, inject
- [README.md](../README.md) — REST API 표 (`audiveris-step-probe`, `audiveris-sheet-steps`)
