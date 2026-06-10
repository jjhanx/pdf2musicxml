# 합창+피아노(S/A/T/B·PR/PL) SYMBOLS·MXL 오인식 대조

악보 **인쇄 마디 번호**(원본 PDF)와 MusicXML `measure@number`가 **한 칸 어긋나는** 경우가 많습니다(도입부·pickup).  
대조 시: **인쇄 마디 ≈ MXL 마디 번호 + 1** 을 먼저 가정하고 확인하세요.

## 성부 매핑(위→아래)

| 순서 | 약어 | Audiveris part-name 예 |
|------|------|-------------------------|
| 1 | S | Soprano |
| 2 | A | Alto |
| 3 | T | Tenor |
| 4 | B | Bass |
| 5 | PR | Piano (오른손) / Piano RH |
| 6 | PL | Piano (왼손) / Piano LH |

```bash
python scripts/verify_score_issues.py score.mxl --measure-offset 1
python scripts/verify_score_issues.py score.mxl --measure-offset 1 --regression
```

## 층별로 고칠 수 있는 것

| 현상 | SYMBOLS UI | MXL `fix_audiveris_mxl` | 근본 |
|------|------------|-------------------------|------|
| 세잇단 `3`→`P` | **해결됨** (PDF 전처리 치환) | **해결됨** (abnormalWord 및 post-fix) | Tesseract 오인식 해소 |
| 세잇단 **숫자·괄호선 소실** | **해결됨** (3 정상 인식) | **해결됨** (Audiveris가 3 인식) | PDF 문자 치환 (`U+F073`->`3`) |
| **PR·PL 세로 정렬** `3` 하나만 PR에 붙음 | 보임 | **불가** | SYMBOLS·다성부 간섭 |
| 세잇단 → **4분음표**로 인식 | 보임 | **불가**(duration 복구 어려움) | RHYTHMS·BEAMS |
| 세잇단 **일부만 연결**(4–5만 묶임) | 보임 | **불가** | BEAMS·SYMBOLS |
| 이음줄 소실·음표 **순서 바뀜** | 보임 | **일부 해결** (인쇄 7마디 이음줄 후처리 복구) | LINKS·RHYTHMS |
| 마디 번호 -1 | — | 수동 대조 | GRID·pickup |

## 보고된 위치 (인쇄 마디·원본 페이지 기준)

MXL·SYMBOLS 점검 시 **마디 번호 +1 보정**. (`--regression`가 아래 마디를 자동 스캔)

### 3페이지 · PL · 15마디
- 7~9번 음: 세잇단 `3` → **`P`**
- 9번·10번 음: **순서 바뀜**

### 4페이지 · PR · 22–23마디
- 22마디 3번 화음 ↔ 23마디 1번 화음 **이음줄** 소실

### 5페이지 · PL · 29마디
- 8분 쉼표 + 3~4번 음: `3`→**`P`**, **세잇단 괄호선** 소실

### 7페이지 · PL · 40마디
- **세잇단 전체 소실** — PR 쪽과 비슷한 높이의 `3` **하나만** 인식되어 PR에만 붙은 듯
- 3번·4번 음: **순서 바뀜**

### 7페이지 · PL · 41마디
- 4~6번 음: 세잇단 **4–5만 연결**, 6번 따로; `3`→**`P`**

### 7페이지 · PL · 45마디
- 1~3·4~6번 음: 세잇단이 **4분음표**로 인식

### 10페이지 · PR · 61마디
- 1~3·4~6번 음: 세잇단 `3`에 **`P` 겹침**

## PR·PL 세잇단 간섭 (7p 40마디)

양손 악보에서 **같은 x·비슷한 y**에 있는 세잇단 `3`을 OMR이 **한 줄(PR)에만** 붙이면, PL 쪽 세잇단·빔·괄호가 통째로 빠집니다.  
`fix_audiveris_mxl`·`strip`으로는 복구되지 않습니다. SYMBOLS·BEAMS 단계에서 **수동 보정** 또는 Audiveris **development 패치**가 필요합니다.

## 검증 순서

1. **TEXTS** 직후 OCR 잔여 삭제 → **SYMBOLS**에서 위 마디 직접 확인  
2. `GET /api/health` → OCR **`eng`**  
3. 변환 후 MXL: `verify_score_issues.py … --measure-offset 1 --regression`  
4. `spuriousDirectionCount`·`regressionChecks`에서 PL/PR 40·45·15·29·61마디 **tuplet 유무** 확인  
5. SYMBOLS만 남으면 [scripts/audiveris-patches/README.md](../scripts/audiveris-patches/README.md)
