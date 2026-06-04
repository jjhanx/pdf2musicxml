# Audiveris 소스 패치 (선택)

SYMBOLS 단계에서 세잇단·성부 약어·조표 오인식이 **엔진 내부** 문제일 때, `AUDIVERIS_BIN`이 가리키는 실행 파일을 **직접 빌드한 Audiveris**로 바꿉니다.

## 왜 필요한가

- TEXTS 단계 OCR이 글리프를 «단어»로 선점하면 SYMBOLS가 같은 픽셀을 음표 기호로 쓰지 못함 ([#46](https://github.com/Audiveris/audiveris/issues/46)).
- `TextWord.checkValidity()`는 `tupletWordRegexp`에 맞는 OCR만 제거함. `3`→`P` OCR은 남을 수 있음.
- pdf2musicxml의 **CLI `-constant` 조정**으로 많은 경우 완화하지만, 100% 대체는 아님.

## 빌드 개요 (Linux 예)

```bash
git clone https://github.com/Audiveris/audiveris.git
cd audiveris
git checkout development   # TUPLET_THREE 수동 할당 등은 development 쪽 문서 참고
# 이 저장소 패치 적용 (선택)
patch -p1 < /path/to/pdf2musicxml/scripts/audiveris-patches/text-tuplet-ocr.patch
./gradlew build
export AUDIVERIS_BIN=/path/to/audiveris/build/install/audiveris/bin/Audiveris
```

Windows는 [Audiveris README](https://github.com/Audiveris/audiveris)의 Gradle·JDK 안내를 따릅니다.

## 패치 파일

| 파일 | 내용 |
|------|------|
| `text-tuplet-ocr.patch` | `TextWord` 기본 regexp: 단독 3/6·`P` OCR 제거 강화 (CLI `-constant`와 동일 취지) |

## pdf2musicxml만 쓸 때

패치 없이도 다음을 **반드시** 적용하세요.

1. 서버 `AUDIVERIS_BIN`이 **재시작 후** pdf2musicxml이 넣는 `-constant`·`-option`을 받는지 확인.  
2. `AUDIVERIS_OCR_LANG=eng` (또는 미설정 → 기본 eng).  
3. 변환 **재실행** — `clean_score` strip은 UI에서 고른 pt만 제거합니다.

패치 빌드는 위로도 부족할 때만 진행하면 됩니다.
