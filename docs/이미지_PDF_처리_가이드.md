# 이미지 PDF 처리 가이드

- 기존 벡터 PDF 처리 외에 이미지 스캔본 PDF를 처리하는 파이프라인 추가.
# 이미지 PDF 처리 가이드

- 기존 벡터 PDF 처리 외에 이미지 스캔본 PDF를 처리하는 파이프라인 추가.
- RapidOCR을 이용해 텍스트와 좌표 추출 (image_pdf_processor.py)
- 추출된 BBox로 PDF 마스킹 (clean_score_only.pdf 생성)
- UI에서 Vector PDF와 Image PDF 중 선택 가능

- UI에서 기본으로 자동 판별(Auto) 모드를 지원하여 업로드된 PDF가 이미지 기반인지(텍스트 50자 미만) 텍스트 기반인지 검사 후 적절한 모드로 자동 라우팅합니다.

### OMR 엔진 동적 라우팅 정책 (General Solution)
- **Vector PDF (`font_separator`)**: Audiveris 엔진 고정 (기존 식당 사항 유지).
- **Image PDF (`image_pdf`)**: 스캔본에서의 음표 위치 인식률을 극대화하기 위해 기본적으로 **AI OMR 엔진(HOMR/TrOMR)**을 추천(기본값)하지만, 사용자가 UI에서 명시적으로 **Audiveris**를 선택하여 박자/빔 처리의 안정성을 확보하는 기존 방식으로 폴백(Fallback)할 수 있도록 인터페이스가 추가되었습니다.
- 동일한 `.mxl` 포맷으로 반환되므로, 가사 병합 및 검수 UI 등 후속 파이프라인은 두 엔진 모두 완벽히 호환됩니다.

### 한글 가사 마스킹 정책 (General Solution - Tesseract 병행 도입)
- Image PDF의 BBox 추출을 담당하는 `RapidOCR` 엔진은 기본 설정(영/중) 시 한글 제목이나 가사를 제대로 잡아내지 못해 텍스트 박스 추출에서 아예 누락되거나 쓰레기 문자(Garbage)로 인식하는 현상이 있습니다.
- 이로 인해 `clean_score_only.pdf`에 제목과 한글 가사 찌꺼기가 지워지지 않고 남는 문제가 발생했습니다.
- **개선 상태 (General Solution)**: 한국어 인식률을 극대화하기 위해 `image_pdf_processor.py`에 **Tesseract OCR (kor+eng)** 추출 로직을 추가로 도입했습니다. RapidOCR이 1차로 영문/기호 BBox를 추출하고, Tesseract가 2차로 한글과 기타 누락된 텍스트의 BBox를 찾아내어 두 결과를 병합(Merge)합니다. 이를 통해 악보의 제목과 한글 가사가 찌꺼기 없이 깨끗하게 마스킹되도록 파이프라인 안정성을 대폭 개선했습니다. (단, 런타임 환경에 `tesseract-ocr` 및 `tesseract-ocr-kor` 시스템 패키지와 파이썬의 `pytesseract` 라이브러리가 필요합니다)
