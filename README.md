# pdf2musicxml

PDF 악보를 **Audiveris**로 변환해 **MusicXML(`.mxl` / `.musicxml`)** 로 내려받는 도구입니다.  
프론트는 **Vite + React + TypeScript**, API는 **Express**이며 [mxlplayer](https://github.com/jjhanx/mxlplayer)와 같은 계열의 웹 스택입니다.

**기본 OMR 엔진은 Audiveris**입니다(`OMR_ENGINE=audiveris`). `clean_score_only.pdf`(가사 제거 PDF)를 인식하고, 검증된 가사는 `inject_ocr.py`로 병합합니다. PDFtoMusic Pro·AI OMR은 선택/실험 옵션입니다. 품질·배포: [docs/악보_변환_품질_가이드.md](docs/악보_변환_품질_가이드.md).

- **Audiveris MXL 없음(HTTP 422)**: 출력 폴더에 `.mxl`/`.musicxml`이 없을 때입니다. 로그에 `Can't connect to X11`·`java.awt.AWTError`가 보이면 **헤드리스 Linux**에서 `DISPLAY`만 잡혀 Audiveris가 GUI 초기화에 실패한 경우입니다.

## 최근 변경 (Audiveris 기본 복귀)

- **OMR 엔진 기본값 Audiveris**: `OMR_ENGINE` 미설정 시 **Audiveris CLI**로 MXL을 생성합니다. PDFtoMusic Pro(`OMR_ENGINE=pdftomusic`)는 **개인용 선택** — 상용 SaaS 자동화는 Myriad CLI 약관상 비권장.
- **변환 방식 선택(웹 UI)**: 업로드 전 **변환 방식**을 고릅니다.
  - **폰트 크기 분리 + Audiveris + 가사 병합**(권장): pdfplumber로 `extracted_music_text.json` 추출 → **폰트 크기 선택 UI** → `clean_score_only.pdf` → Audiveris → **OMR·HITL** → **PyMuPDF 가사 검증·편집** → 병합·주입. strip 시 **NWC·SMuFL 악보 글꼴(≈18–23pt)은 pt 범위에 포함돼도 자동 보호** — `가사+메타(7–36pt)` 실수 선택으로 마디가 통째로 비어 보이는 현상 방지. [docs/악보_변환_품질_가이드.md](docs/악보_변환_품질_가이드.md) 「OMR 입력 PDF — 무엇을 지울까?」.
  - **PyMuPDF 검증 + 마스킹**: 기존 `extract_text.py` → 검토 UI → `mask_pdf.py` → Audiveris → 주입.
  - **OMR만**: 선행 처리·가사 주입 없음.
- **OMR 품질 검토(HITL)**: `mxl-lint`의 **「OMR 불일치 의심 마디」자동 목록은 UI에서 제거**했습니다(오탐이 많음). **PDF·MusicXML 나란히 대조** 후 **마디 클릭 → 해당 마디만 편집** 흐름은 그대로입니다. 마디 편집에서 **세잇단(잇단) 적용·해제**·**빔(연결줄) 연결·해제**·**음표별 direction**(`addNoteDirection`/`setNoteDirection`/`clearNoteDirection` — 셈여림·words·rehearsal, **각 음표·쉼표** 행에서 「direction 추가」, **같은 `#n`에 a tempo+ff 등 복수** 가능, 목록 `dir:mf`/`txt:…` — **P2 파트 ID ≠ staff 2**, PL 필터 **낮은음자리표(F) 유지**)·**「동시 시작 voice 복원」**(화음 아닌 동시·다른 박자 — **전체·PR·PL 모두**, 2단 part는 staff 선택)·**표(articulation) 추가·제거**(Accent 등)·**꾸밈음(grace) 추가·삭제**·**늘임표(fermata) 추가·제거**·**붙임줄(tie) 연결** — 같은 마디 `#n` + **마디 넘김**(다음/이전 MXL m·음높이)·**「여기 뒤」음표·쉼표 삽입**(점음표·점쉼표 포함)·**화음 음 추가**·**음높이·삽입 음표의 임시표**(♯/♭/♮·**♯♯/♭♭**) 를 지원합니다. **성부 필터**는 피아노 `P`를 2줄이면 **PR/PL**로 나누고, MXL 미리보기·마디 편집 모두 해당 줄만 표시합니다(병렬 voice `<backup>` 유지). **전체 악보 OSMD 미리보기**는 2단 grand staff part를 **PR·PL 단일 줄 part로 분리**합니다(저장 MXL은 그대로). **voice별 cursor**로 박자 시각을 계산하고, **순차(비겹침)** 다중 voice를 단일 voice + `<forward>`로 평탄화해 PR·PL **박자 정렬**을 맞춥니다(HITL **음표 삽입·박자 수정** 후 stale backup이 있어도). **「MXL에 반영·미리보기」** 시 timeline 재정렬이 `<forward>` 앞 backup duration을 앞 voice 길이에 맞춥니다. direction은 **part·마디·음표 `#n`** + anchor `voice`·`default-x`(저장 MXL). OSMD에서 PL direction이 P2·P1 등에 어긋나 보이면 **PL 필터**로 해당 줄만 확인. **part-name·instrument-name**은 Audiveris `Voice`/`Piano` 대신 **`part_labels.json` 확정 라벨**(S/A/T/B/PR/PL)을 씁니다(라벨 미확정 시 preset·P1 추정이 잠깐 보일 수 있음). 빔 연결 시 **voice·staff·stem·duration**을 맞추고, **`<beam>`은 화음 리더에만** 기록합니다(`<chord/>` 멤버 beam은 OSMD 미리보기 누락 원인 — `cleanup_chord_beams_mxl.py`로 자동 제거). 삽입 음표는 **`default-x`를 이웃에서 상속**해 반영 후 마디 맨 앞으로 밀리지 않습니다. **「MXL에 반영·미리보기」** 후 편집 중인 마디가 **미리보기 스크롤 영역 세로 중앙**에 오도록 자동 스크롤하며, 반영된 보정은 대기 목록에서 제거되고 baseline MXL에 저장되어, 이후 보정은 누적 재적용 없이 incremental로 반영됩니다. **세잇단 placement**는 `fix_audiveris_mxl.py`와 동일하게 **stem down→below, stem up→above**(쉼표 시작 시 구간 음표 stem 기준). 자세한 절차·문제 해결: [docs/악보_변환_품질_가이드.md](docs/악보_변환_품질_가이드.md) §OMR 품질 검토.
- **같은 PDF 반복 작업 — 시작 단계 선택**: 변환 전 **「변환 시작 단계 선택」**에서 ① **1단계** 원본 PDF(선택: **omr-work.zip**으로 Audiveris만 생략·기존 MXL로 HITL), ② **clean_score_only.pdf + 분리된 가사 JSON**, ③ **omr-work.zip**(가사 포함), ④ **omr-work.zip**(교정 완료 MXL) + **가사 JSON** 으로 이어갈 수 있습니다. 1단계에서는 **clean_score 확인** 직후 **lyric_manifest.json 저장** 모달에서 분리 가사를 내려받을 수 있습니다. 작업 목록에 **단계별 진행**(OMR·HITL·가사 검증 대기 포함)이 표시됩니다. [docs/일반_품질_및_HITL_로드맵.md](docs/일반_품질_및_HITL_로드맵.md).
- **범용 화음(Chord) 및 세잇단음 렌더링 버그 수정**: ① 화음 내 중복 피치 제거 시 새로운 리더(Leader) 음표의 `<chord/>` 태그를 제거하여 이어지는 마디와 박자가 겹치거나 음표가 증발하는 치명적인 버그 해결. ② 세잇단음이 쉼표로 시작할 때 빔(Beam) 반대 방향으로 브라켓을 자동 배치하도록 꼬리 방향 추론 로직 개선. ③ MuseScore 레이아웃 엔진과 충돌하여 화음을 뭉개버리던 강제 `bracket="no"` 주입 로직 제거. ④ 피아노 오른손 화음 이음줄(Slur) 보정 확대.
- **이음줄(Slur) 및 세잇단음표 숫자 누락 버그 수정**: Audiveris 후처리 스크립트(`fix_audiveris_mxl.py`)가 얇은 이음줄(`<bracket>`) 기호를 지우거나 세잇단음표 숫자 '3'을 텍스트 찌꺼기로 오인하여 무차별 삭제하던 문제를 수정하여 정상적으로 출력되도록 개선했습니다.
- **긴 멜리스마 가사 자동 공백 토큰화 버그 수정**: 가사 내에 붙임줄(연장선 `-`)이나 공백이 너무 많을 경우(예: `- 해 마 - 다 - 봄 바람이남으 로- - - 오 -`), 한글 문자의 비율이 40% 미만으로 떨어져 한국어 가사가 아닌 것으로 오인되어 자동 공백 처리가 건너뛰어지는 문제가 발견되었습니다. 이에 따라 한글 문자가 단 1개라도 포함되어 있으면 무조건 한국어 가사로 판단하여 자동 토큰화를 정상적으로 적용하도록 기준을 완화했습니다. 이로써 인쇄 14마디 P4처럼 하이픈이 많은 파트의 가사도 정상적으로 자동 띄어쓰기가 적용됩니다.
- **포스트-OMR 가사 검증 구분 기본값**: OMR·HITL **후** 가사 검증 UI에서 역할 미지정 줄의 **구분 풀다운 기본값은 가사**입니다. 서버 1차 추출도 `lyrics`이며, manifest의 `unknown` 줄은 프론트가 **가사**로 표시합니다. 사용자가 **미분류**를 고르면 `reviewTypeUserSet`으로 유지됩니다(특정 악보 하드코딩 없음).
- **가사 읽기 순서(페이지 넘김)**: `lyric_reading_sort_key`로 페이지 끝 오른쪽 픽업을 다음 페이지 상단 가사보다 뒤에 정렬 — 7마디(2쪽 상단)와 8마디 픽업(1쪽 끝) 순서 뒤바뀜 방지. `merge_lyric_sources.py`·`inject_ocr.py`·가사 검증 UI 공통.
- **포스트-OMR UI '미분류' 강제 해제 버그 수정**: OMR 이후의 가사 병합 모드(Step 2)에서 `poco piu mosso`와 같은 기호나 텍스트를 가사로 병합되지 않도록 '미분류(unknown)'를 선택할 때, 드롭다운 메뉴가 다시 '가사'로 튕겨버리는 UI 강제 맵핑 버그를 수정했습니다. 이제 사용자가 의도적으로 '미분류' 상태를 유지할 수 있어, 악보 내 가사/메타데이터 주입에서 특정 텍스트를 정상적으로 제외할 수 있습니다.
- **OMR 리듬 후처리 기본값 변경**: `fix_audiveris_mxl.py`는 **`AUDIVERIS_MXL_RHYTHM_FIX=off`(기본)** 로 Audiveris **리듬·duration을 그대로** 둡니다. 4분↔8분 추정·끝 𝄽8 삽입·세잇단 펼침은 **`legacy`** 모드에서만. ♩↔♪ 오류는 **OMR 품질 검토(HITL)** 마디 편집으로 수정. [docs/악보_변환_품질_가이드.md](docs/악보_변환_품질_가이드.md).
- **Audiveris 후처리 (최근)**: **최종 MXL**(가사 주입·다운로드·ZIP) 직전에 `normalize_omr_rests.py` → `fix_audiveris_mxl.py` → chord beam 정리를 **자동** 적용합니다. **온쉼표(마디 전체 rest) display-step D 등 한 줄 위로 붙는 현상**, **피아노 grand staff spurious voice·timeline**, **조바꿈 F clef 오인→`<key>` 보충·octave pitch 복구·courtesy clef 제거**, **마디 번호(`lyric_manifest`의 `measure_number`만 최종 MXL `<measure-numbering>`·words로 복원, phantom 자동 번호 제거)** 를 포함합니다(피아노 bass F clef는 유지). **HITL 검토 중** OSMD는 `patchOsmdRender`로 매 렌더마다 `RenderMeasureNumbers=false`를 재적용하고 SVG phantom 숫자를 제거한 뒤, **인쇄 번호만 HTML 오버레이**로 표시합니다. 세잇단 **쉼표 없음→`show-bracket=no`(숫자만)**, **쉼표 포함→bracket 유지**. **PL 미리보기 clef** — grand staff 줄바꿈 마디에 PR G clef만 있을 때 PL에 G가 씌워지던 OSMD split 버그 수정(저장 MXL 불변). **HITL verbatim split** — PR·PL part마다 `<staves>1</staves>`·clef·note staff 정규화(7줄·PR/PL 라벨 중복·PL 음높이 어긋남 방지, 저장 MXL 불변). **조바꿈 F clef 오인 미리보기(일반)** — OSMD load 직전에도 동일 판별(저장 MXL과 별도). **최종 MXL·ZIP 다운로드** 기본명은 원본 PDF(`sourcePdfDisplayName`), `input.pdf`·`upload_clean_score.pdf` 등 세션 내부명 제외. 화음 멤버 beam 일괄 제거 등 **제거**(범용 오류). Audiveris measure-numbering 전체 유지는 **`AUDIVERIS_MXL_KEEP_MEASURE_NUMBERING=1`**.
- **PyMuPDF 검증은 선택**: 폰트 분리 모드에서 「**OMR·HITL 후 PyMuPDF 가사 검증·편집**」 체크를 끄면 pdfplumber 추출만으로 병합합니다(검증 UI 없이 바로 주입). **SATB·다성부 가사**는 성부(`lyricPartIndex`)·줄 순서를 검토 UI에서 지정해야 하므로 **PyMuPDF 검증을 켠 채로** 진행하는 것을 권장합니다. `inject_ocr.py`는 **같은 1절을 여러 파트에 넣을 때** `lyricPartIndex`가 가장 작은 파트를 기준으로 **마디별 음절 개수**만 맞추고, 다른 파트는 **각자 검토한 가사 텍스트**(공백·하이픈 토큰 규칙)를 그 마디에 넣습니다(블록이 한두 줄만 있으면 기준 파트 문구 사용·음절 부족 시 기준 파트로 보충). 파트마다 OMR 음표 subdivision이 다를 때 **뒤쪽 마디 가사 당김**을 줄입니다. 마디 번호·표현어(`poco mosso` 등)는 inject에서 제외됩니다. 검증 UI는 **원본 PDF**(가사 포함) 미리보기를 사용합니다.
- **점검 UI**: 완료 후 **마스킹·인식 점검**에서 원본 vs **`clean_score_only.pdf`** PNG 비교, PDF 다운로드, Audiveris 단계별 실행(`pdfSource=clean_score`)을 지원합니다. 단계 의미·디버깅: [docs/Audiveris_단계별_디버깅.md](docs/Audiveris_단계별_디버깅.md).
- **악보 제목(clean_score 확인)**: 제목과 가사가 **같은 pt**이면 clean_score에 한글 찌끄러기가 남을 수 있습니다. **clean_score_only.pdf 확인** 모달에서 제목 입력·**제목 영역 다시 지우기**로 bbox 마스킹 후 `scoreTitle`이 저장되며 **`lyric_manifest.json` → `inject_ocr.py` → MXL `<work-title>`** 까지 유지됩니다(omr-work ZIP·2단계 manifest 재업로드 포함). [docs/악보_변환_품질_가이드.md](docs/악보_변환_품질_가이드.md) 「제목·가사 같은 pt」.
- **저장 형식 v3**: `lyric_manifest.json` — `items[]`(병합 출처 `provenance`, `fontSize` 등) + `matchStats` + `pymupdfReviewItems`. **`ocr_data.json`(flat)은 PyMuPDF 검토가 있으면 검토 항목만** `inject_ocr.py`에 넘깁니다(pdfplumber IoU 병합 줄은 manifest·마스킹용). 좁은 bbox **마디 번호**(6, 14, 17 …)·**표현어**(`poco mosso` 등)는 inject에서 제외. `inject_ocr.py`는 v2/v3 manifest와 flat 배열 모두 읽습니다.
  - **하이픈(-) 토큰 주의**: 영어 `hel-lo`처럼 **단어 내부 하이픈**은 앞 음절에 붙습니다. 한글 가사에서 보이는 `-`는 보통 **연장/빈칸** 의미이므로 `가 - 살`처럼 **공백으로 분리된 단독 토큰**으로 두는 것이 안전합니다(자동 공백도 한글 주변 `-`는 분리).
- **한글·ZIP 파일명**: `POST /api/convert` 멀티파트 파일명 디코딩은 그대로 유지합니다.
- 자세한 품질·호환 대응은 [docs/악보_변환_품질_가이드.md](docs/악보_변환_품질_가이드.md), 배포 점검은 동 문서 **「서버 배포 후 점검 체크리스트」**를 따르세요.

## 기능

- **웹 UI**: PDF 파일 선택(복수), **드래그 앤 드롭**(전용 영역), 일괄 변환(순차 처리), 파일별 진행 표·개별 다운로드(실패 행 **결과** 열에는 서버 오류 메시지 전체를 줄바꿈으로 표시)
- **진행 표시**: 업로드 단계와 **Audiveris** OMR 단계의 진행 상황을 표시합니다.
- **한글 제목·가사(OCR)**: Audiveris는 글자에 Tesseract를 쓰며, **clean_score(악보만) 변환 기본은 `eng`**입니다. PDF에 한글을 Audiveris가 직접 읽게 하려면 **`AUDIVERIS_OCR_LANG=kor+eng`** 등을 설정하세요. `kor.traineddata` 등은 [docs/악보_변환_품질_가이드.md](docs/악보_변환_품질_가이드.md) 「한글 인식 문제」류 절과 아래 환경 변수 표를 참고하세요.
- **고해상도 OCR 및 벡터 PDF 직접 추출**: 검토 UI용 글자·좌표 추출은 예전처럼 항상 300 DPI OCR만 쓰면 서버 부하와 중단 위험이 컸습니다. 현재는 `PyMuPDF`로 **벡터 PDF**에 내장된 글자와 좌표를 우선 빠르게 읽고, 텍스트가 없는 **이미지 PDF**일 때만 300 DPI **RapidOCR**(한국어 PP-OCRv5)로 대체 인식합니다.
- **문자-악보 사전 매핑 (폰트 분리 모드)**: **Audiveris OMR·마디 검토(HITL)가 끝난 뒤** 팝업으로 **원본 PDF**에서 추출한 글자의 역할을 지정(`제목`, `작사가`, `가사`, **`템포(BPM)`** 등)합니다. (구 **PyMuPDF 마스킹** 방식은 Audiveris **전**에 같은 UI를 띄웁니다.) 검토 카드에서 **「미리보기」**를 누르면 위 PNG에 해당 줄 **OCR bbox(청록 점선)** 와 귀퉁이 표시가 뜹니다. 귀퉁이·변 근처를 드래그해 bbox를 줄이거나, 안쪽을 드래그해 이동할 수 있습니다(저장된 `bbox`만 갱신하고 **`spans`는 제거**되어 줄 단위 마스킹으로 전환). **추가**로 페이지 빈 공간에서 사각형을 그리면 **수동**(MUSIC SAFE 없음) 지우기 영역이 됩니다(음표·오선 근처는 가능한 좁게). **페이지 미리보기 위에 가사 줄만 추가로 칠해서 지울 영역**(수동 마스킹)과 병행 가능합니다. **템포**로 지정한 영역은 마스킹되고, 검토한 BPM(예: `75`, `♩= 75`)은 `inject_ocr.py`가 첫 마디 MusicXML에 `<sound tempo="…">` 및 metronome으로 넣어 **재생기가 기본 120으로 도는 문제**를 줄입니다. 지정된 영역은 Audiveris에 넘어가기 전 **`mask_pdf.py`** 가 처리합니다. **가사** 블록(선택 리덕 모드 기본 켜짐)은 PyMuPDF로 **복사 가능한 텍스트 글림만** 하나씩 처리하며, `rawdict` 추출에 기본 포함되는 **SIDE_BEARINGS·ASCENDERS**(정확 bbox) 플래그로 과대 글림 bbox를 줄입니다. **`MASK_PDF_GLOBAL_HANGUL_SYLLABLE_BLANK`** 로 페이지 전역 한글 완성형·자모 추가 블랭크가 **기본 켜져** 있습니다(`0`/`false`/`off`로 끔). 리덕의 기본 형태는 **`fill=False` + 공백(또는 `MASK_PDF_LYRIC_REPLACE_CHAR`) 치환**이라 **오선 등 벡터 위에 깔던 흰 리덕 박스**보다 표기가 더 잘 살아남습니다(`MASK_PDF_LYRIC_PLAIN_REDACT=1` 로 예전 흰 fill 리덕 복귀). MuPDF 특성상 **리덕 사각형과 bbox가 겹치는 텍스트**는 지울 수 있어(`set_small_glyph_heights`), **음표·SMuFL 텍스트 글림과 라틴 등 가사 글림이 면적으로 충분히 겹치면**(`MASK_PDF_LYRIC_MUSIC_SAFE` 기본값) 해당 글자만 리덕을 생략합니다. **한글**은 같은 줄 교착 잔류가 생기기 쉬워 **기본으로 이 겹침 검사를 생략**합니다(`MASK_PDF_LYRIC_IGNORE_MUSIC_OVERLAP_FOR_KOREAN`). 교차만으로 예전처럼 생략하려면 `MASK_PDF_LYRIC_MUSIC_LEGACY_INTERSECT=1` 입니다. 생략된 글자는 남습니다. `MASK_PDF_LYRIC_REDACT_PASSES`·최소 리덕 높이(세로 부족 시 **아래로만** 패딩)·**`MASK_PDF_LYRIC_REDACT_MAX_HEIGHT_EM`(기본 1.14)** 로 리덕 세로를 **폰트 크기 근처**까지 줄여 **위·아래 인접 스태프**(윗 성부 가사 bbox가 과대하게 아래 줄 머리까지 내리꽂거나, 역으로 아래 줄이 위로 비대하게 뻗은 경우)와의 교차 손실을 줄입니다. **벡터** 추출 줄에 **`spans`(span별 bbox)** 가 있으면 기본적으로 **그 세그먼트** 좌표에만 블랭크를 거는 경로가 우선됩니다(`MASK_PDF_LYRIC_USE_EXTRACT_SPANS`). 한글만 아래쪽을 더 남기려면 선택적으로 **`MASK_PDF_LYRIC_REDACT_KOREAN_BOTTOM_KEEP_FRAC`**(예: `0.78`)를 줍니다. 전체 가사 영역을 흰 박스로만 덮는 폴백은 `MASK_PDF_LYRIC_WHITE_FALLBACK=1`입니다. 가사 블록을 통째로 흰 박스로만 덮으려면 `MASK_PDF_LYRIC_SELECTIVE=0`입니다. 제목·템포 등 다른 분류는 종전처럼 bbox 전체를 흰 박스(또는 선택 `MASK_PDF_TEXT_REDACT=1`)로 덮습니다. **가사**는 글자별 하이픈(`-`)으로 “이 음표는 가사 없음”을 표시할 수 있으며, MXL에 합칠 때 **파트 순번**, **가사 절**(1절·2절… → `<lyric number>`), **멜로디 줄**(MusicXML `<voice>`, 동시에 울리는 다른 선율용·1절/2절과 **다름**), **`*`**(문서 순 멜로디), **앞쪽 음표 생략**을 지정합니다. 블록 옆 **신뢰도**는 OCR 참고용입니다. 각 항목의 의미는 [docs/악보_변환_품질_가이드.md](docs/악보_변환_품질_가이드.md) 「검토 UI → MusicXML 가사 주입」절에 설명합니다.
- **성부 라벨(S/A/T/B/P/PR/PL)**: 문자 검토에서 적은 값은 `part_labels_preset.json`(초안)에 저장됩니다. OMR 직후 **성부 라벨 지정** 모달은 MXL 파트 수와 **문자 검토 preset 중 큰 쪽**(OMR이 3파트만 만들어도 SATB+피아노 6성부 표시)을 보여 주며, **파트 수·+ 추가**로 늘릴 수 있습니다. **확정**하면 `part_labels.json`이 생깁니다.
- **Audiveris 직후 OMR 품질 검토(HITL, 기본 켜짐)**: 성부 라벨 확정 후 **PDF·MusicXML(OSMD) 나란히 미리보기**로 대조하고, **오른쪽 악보에서 마디를 클릭**(오선·음표 영역, 호버 시 파란 표시)해 점(·)·쉼표·음표·**세잇단**·**빔** 등을 요소별 보정 → **MXL에 반영·미리보기**로 OSMD에서 확인 → **이어하기**로 최종 MXL까지 반영합니다(MuseScore 불필요). **작업 저장(ZIP)/불러오기**로 검토를 중단·재개할 수 있으며(ZIP에 **clean_score·원본 PDF·lyric_manifest.json** 포함), **3단계**에서 **omr-work.zip**으로 Audiveris 없이 이어가거나, **4단계**에서 교정 완료 ZIP + 가사 JSON으로 가사 검증·주입만 진행할 수 있습니다. [docs/일반_품질_및_HITL_로드맵.md](docs/일반_품질_및_HITL_로드맵.md), [docs/악보_변환_품질_가이드.md](docs/악보_변환_품질_가이드.md) §OMR 품질 검토.
- **Audiveris 직후 보정**: 「Audiveris 직후 멈춤」을 켜면 **악보 인식 직후** MXL을 받아 MuseScore 등에서 음높이·음표를 확인한 뒤, 웹의 **Audiveris 결과 보정** 모달에서 **조옮김(반음)**·**교체 MXL**을 지정해 이어갈 수 있습니다(글자·가사 역할 검토 단계와는 별개). 조옮김은 **곡 전체가 같은 간격만큼만** 밀린 경우에 해당하고, 일부만 틀리면 편집 후 MXL 교체가 맞습니다. 자세한 설명은 동 문서 「Audiveris 직후 수동 보정」절을 참고하세요.
- **결과 자동 저장**: UI에서 "결과 저장하기"를 체크하면 변환이 완료된 후 별도로 저장 버튼을 누르지 않아도 **자동으로 `.mxl` 파일이 다운로드**됩니다. 파일명은 업로드한 **원본 PDF 이름**(예: `곡제목.mxl`)을 기본으로 하며, 2단계만 이어할 때는 `*-clean-score-only.pdf` 이름에서 접미사를 뺀 값을 씁니다.
- **비동기 변환(폴링)**: 변환(Audiveris)은 시간이 오래 걸리므로 **완료 후 곧바로 파일을 응답하지 않습니다.** `POST /api/convert`는 **PDF 수신·저장이 끝난 뒤** **HTTP 202** 와 `jobId`를 돌려주고, 실제 변환은 서버 백그라운드에서 돌아갑니다. 클라이언트는 **상태 API를 주기적으로 조회**한 뒤, 완료 시 **다운로드 API**로 결과를 받습니다. (과거에는 업로드 도중 202를 보내 일부 환경에서 본문 전송이 멈추는 문제가 있어, 202 시점을 저장 완료 후로 옮겼습니다.)
- **결과 보관 기간(TTL)**: 변환이 **완료되었거나 최종 실패로 판정된 시점**부터 **24시간**이 지나면 서버 메모리의 작업 기록과 임시 결과 파일을 자동으로 삭제합니다. **`GET /api/download`로 받은 뒤에도** 같은 `jobId`로 **마스킹·인식 점검**(진단 API·웹 점검 패널)을 쓸 수 있습니다(TTL 전까지). UI와 `GET /api/health` 응답에 동일 안내가 포함됩니다.
- **마스킹·Audiveris 인식 점검 UI**: 변환 완료·실패 행에서 **마스킹·인식 점검**으로, **페이지별** 원본 PDF와 마스킹 PDF를 나란히 PNG로 비교합니다. Audiveris **MusicXML**은 OpenSheetMusicDisplay로 미리보며, **파트(성부)** 단위로 필터해 한 줄씩 보기 쉽게 할 수 있습니다. 같은 패널에서 **Audiveris 단계별 실행**(예: `-step GRID`)으로 로그·`.omr`을 받아 이슈 재현에 쓸 수 있습니다 — 단계별 의미·디버깅 순서는 [docs/Audiveris_단계별_디버깅.md](docs/Audiveris_단계별_디버깅.md). **Audiveris 결과 보정** 모달에서도 **마스킹·인식 점검** 탭을 열 수 있습니다.
- **REST API**: `POST /api/convert`, `GET /api/status/:jobId`, `GET /api/download/:jobId`, 진단용 `GET /api/diagnostic/...`, `GET /api/health` (아래 [REST API (비동기)](#rest-api-비동기) 참고)
- **CLI**: `npm run convert -- <파일.pdf>` → 기본 저장 `~/Downloads`(Linux) 등
- **운영 모드**: `npm run build` 후 `dist`를 Express가 같은 포트에서 서빙 (`npm run start:prod`)

## 필요 조건

- **Node.js** 20+ 권장
- **Python** 3.10+ (RapidOCR·PyMuPDF·**pdfplumber·pikepdf** 가사 분리·병합·주입 파이프라인용)
- **Audiveris** — **기본 OMR**. [GitHub Releases](https://github.com/Audiveris/audiveris/releases) `.deb` 등
- **PDFtoMusic Pro** — **선택(개인용)**. `OMR_ENGINE=pdftomusic`. 상용 SaaS 자동화 비권장 — [docs/PDFtoMusic_배포_가이드.md](docs/PDFtoMusic_배포_가이드.md)
- **AI OMR** — **선택(실험)**. `OMR_ENGINE=ai`. [docs/AI_OMR_배포_가이드.md](docs/AI_OMR_배포_가이드.md)

Python 환경:

```bash
cd /path/to/pdf2musicxml
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### Ubuntu에서 Audiveris (기본)

[GitHub Releases](https://github.com/Audiveris/audiveris/releases)에서 `.deb` 설치 후:

```bash
sudo apt install -y ./Audiveris-*-ubuntu24.04-x86_64.deb
export AUDIVERIS_BIN=/opt/audiveris/bin/Audiveris
/opt/audiveris/bin/Audiveris -help
```

Linux에서 `pikepdf` 설치가 실패하면 QPDF 개발 라이브러리가 필요할 수 있습니다.

```bash
sudo apt-get install -y libqpdf-dev   # Debian/Ubuntu
pip install pikepdf pdfplumber
```
*(참고: 리눅스 환경에서 PDF 이미지 변환 시 `sudo apt-get install poppler-utils`가 필요할 수 있습니다.)*

## 환경 변수

| 변수 | 설명 |
|------|------|
| **`OMR_ENGINE`** | **`audiveris`(기본)** \| **`pdftomusic`**(선택·개인용) \| **`ai`**(실험) |
| **`AUDIVERIS_BIN`** | **기본** — Audiveris 실행 파일. 예: `/opt/audiveris/bin/Audiveris` |
| `P2MP_BIN` | `OMR_ENGINE=pdftomusic` 일 때. 상용 SaaS 비권장 |
| `AI_OMR_BACKEND` | **`homr`** \| `tromr` \| `mock` — `OMR_ENGINE=ai` 일 때만 |

**Audiveris 품질·배포:** [docs/악보_변환_품질_가이드.md](docs/악보_변환_품질_가이드.md) · PDFtoMusic(선택): [docs/PDFtoMusic_배포_가이드.md](docs/PDFtoMusic_배포_가이드.md) · AI OMR(실험): [docs/AI_OMR_배포_가이드.md](docs/AI_OMR_배포_가이드.md)

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
| `CLEAN_SCORE_REPLACE_TRIPLET_PUA` | `1`이면 `clean_score_only.pdf` strip 직후 PDF 내 U+F073→`3` 치환(기본 **끔** — PyMuPDF 재저장 시 **음표 머리 손실** 위험). 세잇단은 MXL 후처리(`fix_audiveris_mxl`)로 보완. |
| `AUDIVERIS_MXL_FIX` | 기본 켜짐. `0`/`false`이면 `inject_ocr.py` 직전 `fix_audiveris_mxl.py`(잔여 P/2P direction 등) 생략. **SYMBOLS UI에는 영향 없음.** |
| `AUDIVERIS_MXL_RHYTHM_FIX` | **`off`(기본)** — OMR 리듬 duration 그대로(HITL에서 수정). `beams`=빔 근거 4분↔8분만. `legacy`=예전 전체 자동 리듬 보정. 서버·inject는 명시적으로 `off`. |
| `AUDIVERIS_MXL_KEEP_REDUNDANT_NATURAL` | 기본 **끔**(= 조표·음높이상 불필요한 `<accidental>natural</accidental>` **제거**). `1`이면 OMR 제자리표 태그 유지. |
| `AUDIVERIS_MXL_NORMALIZE_KEYS` | 기본 **끔**(= Audiveris `<key>` **그대로**, OMR HITL 미리보기·사람 보정). `1`이면 줄머리 1♯ 오인·courtesy 반복만 자동 정리. |
| `AUDIVERIS_MXL_OPENING_KEY_EXPLICIT` | 기본 **끔**(= m1 `<key>` 생략 시 **`fifths=0` 자동 주입 안 함**, HITL·OMR 조표 그대로). `1`이면 m1·픽업 조표 없고 첫 `<key>`가 m2+일 때 C major 명시(OSMD가 뒤쪽 조표를 앞머리로 당기는 현상 완화, 구 동작). |
| `AUDIVERIS_MXL_KEEP_INVENTED_KEYS` | `1`이면 **`NORMALIZE_KEYS`와 동일하게 조표 자동 정리 끔**(별칭). |
| `AUDIVERIS_MXL_KEEP_MEASURE_NUMBERING` | 기본 **끔**(= Audiveris `<measure-numbering>` **제거**, phantom 줄머리 번호 방지). `1`이면 MusicXML measure-numbering 유지(MuseScore 줄머리 번호 표시용). |
| `AUDIVERIS_MXL_ACCIDENTAL_REPAIR` | 기본 **끔**. `1`이면 `#`↔natural 추정·duplicate pitch sharp 보정(`fix_audiveris_mxl.py`). |
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
export OMR_ENGINE=audiveris
export AUDIVERIS_BIN=/opt/audiveris/bin/Audiveris
# 선택 PDFtoMusic: export OMR_ENGINE=pdftomusic && export P2MP_BIN=/usr/bin/p2mp
# 실험 AI OMR: export OMR_ENGINE=ai && export AI_OMR_BACKEND=homr
# 전역 한글 블랭크는 기본 켜짐. 끄려면: export MASK_PDF_GLOBAL_HANGUL_SYLLABLE_BLANK=0
```

### 서버 배포 요약 (운영)

1. **코드 반영**: `git pull origin main` (또는 배포 브랜치).
2. **의존성**: venv 활성화 후 `pip install -r requirements.txt`, Node는 `npm ci` 또는 `npm install`.
3. **프론트 빌드**: `npm run build` — `start:prod`는 `dist`를 서빙합니다.
4. **환경 변수**: 기본 **Audiveris**(`OMR_ENGINE=audiveris`, `AUDIVERIS_BIN`). PM2/systemd 반영 후 **프로세스 재시작** (진행 중 변환·HITL 대기 job이 없을 때만).
5. **동작 확인**: `GET /api/health` → `omrEngineReady: true`, `audiverisConfigured: true`. — [docs/악보_변환_품질_가이드.md](docs/악보_변환_품질_가이드.md) 「서버 배포 후 점검 체크리스트」.

한 줄 점검 (Linux 예):

```bash
cd /path/to/pdf2musicxml && git pull && source venv/bin/activate && pip install -r requirements.txt && npm run build && pm2 restart pdf2mxl
```

OMR HITL 사용 시 변환 1회는 **성부 라벨 확정 → OMR 이어하기 → 완료**까지 기다립니다. 로그: `pm2 logs pdf2mxl --lines 100 --nostream | grep -E "Part labels saved|inject_ocr|apply_part_labels|Completed"` — [docs/일반_품질_및_HITL_로드맵.md](docs/일반_품질_및_HITL_로드맵.md) §A 참고.

## 설치·실행

```bash
git clone https://github.com/jjhanx/pdf2musicxml.git
cd pdf2musicxml
npm install
pip install -r requirements.txt
```

### 개발 (Vite HMR + API)

```bash
pip install -r requirements.txt
npm run dev
```

- 웹: `http://호스트:5173` (Vite는 `host: true`로 LAN 접속 가능)
- API: `8787`, 프록시 `/api` → `8787`

### 운영 (빌드 + 단일 포트)

```bash
npm run build
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
pm2 start npm --name "pdf2mxl" -- run start:prod

# 3. 재부팅 시 자동 실행 등록
pm2 startup
pm2 save

# 로그 확인: pm2 logs pdf2mxl
# 재시작: pm2 restart pdf2mxl  (변환·HITL 대기 중이면 job이 끊김 — 유휴 시에만)
```

`pm2 logs`의 **error** 스트림에 `merge_lyric_sources.py` 통계(`Output:`, `stats`)가 보여도 대부분 **실패가 아닙니다**. MXL 성부명이 **Voice**로만 나오면 성부 라벨·OMR 단계를 끝까지 진행했는지와 `apply_part_labels` 로그를 확인하세요.

### CLI만

```bash
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
| `GET /api/status/:jobId` | `pending` → `processing` → `review_needed` → (`audiveris_review_needed`) → `completed` \| `failed`. **`Cache-Control: no-store`**. `review_needed`이고 OMR·HITL 후 가사 검증이면 **`reviewAfterOmr`**, **`hasSavedLyricReview`** 포함. `processing`·대기 상태일 때 **`progress`**: `phase`, `current`, `total`, 선택 `detail`(가사 검증 생략 시 `가사 검증 생략 — 원본 PDF…` 등) |
| `GET /api/review/:jobId` | 상태가 `review_needed`일 때 추출된 문자 영역(좌표/텍스트) 데이터 가져오기 |
| `GET /api/review/:jobId/note-counts` | 가사 검증 UI 힌트용. 현재 MusicXML에서 **파트/voice별 가사 대상 음표 수** JSON(쉼표·그레이스 제외). |
| `GET /api/review/:jobId/pdf-dimensions` | `review_needed` 단계만. 업로드 PDF 페이지 크기(pt) JSON(`pdf_diagnostic.py pagesizes`) — 수동 가사 마스킹 좌표 변환 |
| `GET /api/review/:jobId/pdf-page-png/:pageNum` | `review_needed` 단계만. 한 페이지 미리보기 PNG(쿼리 `dpi` 기본 **118**) |
| `POST /api/review/:jobId` | 본문은 **항목 배열**이거나 `{ "items": [...], "transposeSemitones"?: number }` — 마스킹·가사 분류 제출 후 Audiveris 단계 재개. 수동 마스킹은 항목 `type`: `_manual_lyric_mask`, `manualRects`: `[{ "page": 1, "bbox": [x0,y0,x1,y1] }, …]`(PDF pt·PyMuPDF 좌표)로 포함됩니다. `transposeSemitones`는 API·고급용(가사 검토 웹 UI에서는 생략, 0과 동일); 음높이 조정 안내는 「Audiveris 직후 수동 보정」 참고 |
| `POST /api/review/:jobId/reset-lyrics-initial` | OMR·HITL **이후** `review_needed` 단계만. 원본 PDF **1차 추출**로 되돌림(역할 기본 **가사**) |
| `POST /api/review/:jobId/load-saved-lyrics` | OMR·HITL **이후** `review_needed` 단계만. omr-work.zip의 `ocr_data_pymupdf.json` 저장본(세션의 `ocr_data_pymupdf_saved.json`)을 불러옴 |
| `GET /api/review/:jobId/lyric-source-info` | `{ hasSavedLyricReview, hasBaseline, reviewPreservesEdits?, partLabelsPreset?, partLabelsSaved? }` — ZIP 저장 가사·1단계 편집 이어하기·성부 라벨 복원 여부 |
| `GET /api/raw-mxl/:jobId` | `omr_staff_review_needed` 또는 `audiveris_review_needed` 일 때 Audiveris가 만든 **주입 전** MXL 다운로드 |
| `POST /api/continue-audiveris/:jobId` | `audiveris_review_needed` 해제: **`application/json`** `{ "transposeSemitones": number }` 또는 **`multipart/form-data`**: 필드 `transposeSemitones`, 선택 파일 필드명 **`mxl`** (교체 MXL). 이후 OCR·가사 주입 단계 진행 |
| `GET /api/download/:jobId` | `completed` 일 때만 단일 MXL/MusicXML 또는 ZIP 스트림. 완료 전·실패 후는 409. 다운로드 후에도 작업·임시 파일은 **24시간 TTL** 전까지 유지되며, 진단 API·재다운로드 가능 |
| `GET /api/diagnostic/:jobId/summary` | **`completed`**, **`omr_staff_review_needed`**, **`audiveris_review_needed`**, 또는 **`failed`** 일 때. 원본/마스킹 PDF 존재·페이지 수·MusicXML 미리보기 가능 여부 JSON (`Cache-Control: no-store`) |
| `GET /api/diagnostic/:jobId/omr-policy` | job별 OCR·TextWord 상수·P 유발 경로·lint 요약 |
| `GET /api/diagnostic/:jobId/mxl-lint` | Audiveris 직후 MXL lint JSON. `part_labels.json` 저장·갱신 시 캐시를 무효화하고 성부 라벨을 반영합니다. 쿼리 `page`, `staff`(S/A/T/B/PR/PL), 강제 재생성 `regen=1` |
| `GET /api/diagnostic/:jobId/score-parts` | Audiveris MXL part-list + 저장·초안 라벨 |
| `GET` / `POST /api/font-strip/:jobId` | **`font_strip_needed`** 일 때 폰트 pt 제거 범위 조회·저장 |
| `GET /api/clean-score-preview/:jobId` | **`clean_score_preview_needed`** 일 때 strip 결과 요약 |
| `GET /api/clean-score-preview/:jobId/page/:n/png` | 미리보기 PNG (`source=original` \| `clean_score`) |
| `GET /api/clean-score-preview/:jobId/pdf` | `clean_score_only.pdf` 열기·다운로드 (`?download=1`) |
| `POST /api/clean-score-preview/:jobId/continue` | 미리보기 확인 후 Audiveris 단계로 진행 |
| `POST /api/clean-score-preview/:jobId/score-title` | **`scoreTitle`** `{ text, bbox?, page?, applyMask? }` 저장·제목 bbox 마스킹 재적용 |
| `POST /api/clean-score-preview/:jobId/redo-font-strip` | 폰트 범위 재선택( strip 재실행 ) |
| `GET /api/lyric-manifest/:jobId` | **`lyric_manifest_save_needed`** 등 — 병합된 `lyric_manifest.json` 요약 |
| `GET /api/lyric-manifest/:jobId/download` | `lyric_manifest.json` 파일 다운로드 |
| `POST /api/lyric-manifest/:jobId/continue` | 저장 확인 후 OMR 단계로 진행 |
| `POST /api/part-labels/:jobId` | **`part_labels_needed`** 일 때 `{ "labelsByIndex": ["S","A",…] }` 저장 후 계속 |
| `GET` / `POST /api/omr-hitl/:jobId/fixes` | OMR HITL 대기 보정 목록 저장 |
| `POST /api/omr-hitl/:jobId/apply` | 보정을 Audiveris MXL에 반영·lint 재생성 (원본 MXL 백업에서 후처리·보정 재합성) |
| `POST /api/omr-hitl/:jobId/sync-preview` | OMR 검토 패널용 MXL을 **Audiveris 원본 백업 → 후처리 → HITL 보정** 순으로 재빌드 |
| `POST /api/omr-hitl/:jobId/normalize-rests` | 전체 성부 OMR 자동 정리 — 쉼표·이음줄(slur)·세잇단 숫자·가짜 staccato (`fix_audiveris_mxl` + `normalize_omr_rests`, **Audiveris 직후·검토 MXL**) |
| `GET /api/omr-hitl/:jobId/export-work` | OMR 검토 진행 ZIP (review.mxl, audiveris_raw.mxl, 보정 JSON 등) |
| `POST /api/omr-hitl/:jobId/import-work` | 위 ZIP 업로드로 검토 진행 복원 |
| `GET /api/omr-hitl/:jobId/measure` | 마디별 음·쉼 목록 (`partId`, `measureMxl`) |
| `POST /api/continue-omr-staff-review/:jobId` | **`omr_staff_review_needed`** 일 때 OMR HITL 이어하기(보정 자동 적용 후 inject) |
| `GET /api/diagnostic/:jobId/page/:pageNum/png` | 쿼리 `source=original` 또는 `masked`, 선택 `dpi`(72–240, 기본 132). PyMuPDF로 해당 페이지 PNG |
| `GET /api/diagnostic/:jobId/score-musicxml` | Audiveris MXL → MusicXML(미리보기). **OMR 품질 검토·진단 OSMD**용 — 요청마다 `fix_audiveris_mxl.py` 적용 후 추출 |
| `GET /api/diagnostic/:jobId/masked-pdf` | Audiveris에 넣기 직전 **`masked_input.pdf`** (`application/pdf`). 기본 `inline`(새 탭), `?download=1`이면 다운로드 |
| `GET /api/diagnostic/:jobId/original-pdf` | 세션에 남은 **업로드 원본 PDF**. 동일하게 `?download=1` 지원 |
| `POST /api/diagnostic/:jobId/audiveris-step-probe` | **`completed` / `audiveris_review_needed` / `failed`** 작업만. 본문 JSON: `step`(필수, 예: `GRID`), `force?`, `sheets?`(예: `"1 4-7"`), `pdfSource?`(`clean_score`\|`masked`\|`original`). 서버가 Audiveris `-batch -save -step …`( **`-export` 없음** ) 실행 후 `exitCode`, `stdout`/`stderr`(길면 잘림), `argv`, `artifacts`, `runId` 반환. **단계 설명·사용법:** [docs/Audiveris_단계별_디버깅.md](docs/Audiveris_단계별_디버깅.md) |
| `GET /api/diagnostic/:jobId/audiveris-step-probe/:runId/download` | 위 실행 결과물 다운로드. 쿼리 **`rel`** = 해당 실행 폴더 기준 상대 경로 (예: `piece/book.omr`). 경로 탈출 차단 |

프론트엔드(`src/App.tsx`)는 변환 접수 후 **약 2초 간격**으로 `/api/status/:jobId`를 호출하고, **`review_needed` 진입마다** 가사 검증·편집(폰트 분리·OMR·HITL 후) 또는 문자 검토(PyMuPDF 마스킹·Audiveris 전) 모달, **`audiveris_review_needed`**이면 Audiveris 결과 보정 모달을 띄웩니다. 제출은 각각 `/api/review/:jobId`, `/api/continue-audiveris/:jobId`로 이어집니다. 완료 행의 **마스킹·인식 점검**은 동일 `jobId`로 진단 API를 사용합니다. **변환 실패** 행에서도 세션이 남아 있으면 동일 버튼으로 점검·**Audiveris 단계별 실행** GUI를 열 수 있습니다.

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
- **Failed to fetch (변환 목록에 실패)**  
  브라우저가 **`GET /api/status` 폴링 중 네트워크가 끊긴** 경우입니다. 노트북 절전·Wi‑Fi 재연결·브라우저 탭 장시간 백그라운드·**서버 `pm2 restart`** 등이 흔한 원인입니다. 최신 UI는 **최대 12시간** 네트워크 끊김까지 자동 재시도합니다. 그래도 실패하면 서버에서 `pm2 logs pdf2mxl --lines 100`으로 **작업이 서버에서 끝났는지** 확인하세요. 서버 재시작 후에는 메모리上的 jobId가 사라지므로 **처음부터 다시** 하거나, 이미 만든 **`clean_score_only.pdf`·`lyric_manifest.json`·`omr-work.zip`** 으로 **2~4단계**만 이어가는 것이 안전합니다. **1단계 full을 밤새 브라우저만 켜 두고 기다리기**보다 단계별 저장·재개를 권장합니다.
- **변환 버튼 클릭 시 아무 반응 없음**: 과거 빌드에서 존재하지 않는 `runBatch()`를 호출하는 버그가 있었습니다. 최신 `main`을 받아 다시 빌드하세요.
- **HTTP(평문) 접속**: `crypto.randomUUID()`는 보안 컨텍스트에서만 안전하게 쓰이므로, 평문 HTTP에서는 대체 ID 생성으로 처리합니다.
- **변환 버튼이 반응 없음(그 외)**: 브라우저별로 드롭 직후 `FileList`가 비는 경우가 있어 `DataTransfer.items` 경로를 추가했습니다. 서버는 정적 파일이 `/api`를 덮지 않도록 정리되어 있습니다.
- **OMR HITL 「이어하기」 후 가사 검증 모달이 안 뜸**: (1) **「OMR·HITL 후 PyMuPDF 가사 검증·편집」** 체크. (2) OMR 패널에서 **「이어하기」** 필수. (3) 세션에 **원본 PDF**(`input.pdf`) — omr-work ZIP 포함 또는 1단계 업로드. `clean_score_only`만 있으면 서버가 단계 생략(작업 표 `가사 검증 생략…`). (4) Audiveris 보정 대기가 먼저일 수 있음. `npm run build` + `pm2 restart pdf2mxl`. 상세: [docs/악보_변환_품질_가이드.md](docs/악보_변환_품질_가이드.md)
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
│   ├── apply_omr_hitl_fixes.py # OMR HITL 보정을 MXL에 적용
│   ├── cleanup_chord_beams_mxl.py # 화음 멤버 orphan beam 제거(OSMD 호환)
│   ├── omr_hitl_lib.py         # HITL 보정 라이브러리(빔·세잇단·마디 스냅샷 등)
│   └── convert-cli.ts
├── src/
│   ├── App.tsx
│   └── AudiverisInspectPanel.tsx
└── vite.config.ts
```

## 라이선스

저장소에 별도 명시가 없으면 저장소 소유자 정책을 따릅니다. Audiveris·사용 라이브러리는 각각의 라이선스를 따릅니다.
U p d a t e d   U I   b u g   f i x e s   a n d   t e x t   e x t r a c t i o n   l o g i c 
 
 