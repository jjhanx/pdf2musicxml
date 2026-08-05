# 이미지 PDF 처리 가이드

- 기존 벡터 PDF 처리 외에 이미지 스캔본 PDF를 처리하는 파이프라인 추가.
- RapidOCR을 이용해 텍스트와 좌표 추출 (image_pdf_processor.py)
- 추출된 BBox로 PDF 마스킹 (clean_score_only.pdf 생성)
- UI에서 Vector PDF와 Image PDF 중 선택 가능

- UI에서 기본으로 자동 판별(Auto) 모드를 지원하여 업로드된 PDF가 이미지 기반인지(텍스트 50자 미만) 텍스트 기반인지 검사 후 적절한 모드로 자동 라우팅합니다.

### OMR 엔진 동적 라우팅 정책 (General Solution)
- **Vector PDF (`font_separator` 등)**: Audiveris 엔진 고정 (기존 튜닝 사항 유지).
- **Image PDF (`image_pdf`)**: 스캔본에서의 인식률을 극대화하기 위해 전역 `OMR_ENGINE` 설정과 무관하게 동적으로 **AI OMR 엔진(HOMR 등)으로 강제 전환**합니다.
- 동일한 `.mxl` 포맷으로 반환되므로, 가사 병합 및 검토 UI 등 후속 파이프라인은 두 엔진 모두 완벽히 호환됩니다.

### 한글 가사 마스킹 정책 (General Solution)
- Image PDF의 BBox 추출을 담당하는 `RapidOCR` 엔진은 기본 설정(영/중) 시 한글을 제대로 잡아내지 못해 마스킹(`clean_score.pdf`) 단계에서 한글 가사가 지워지지 않고 남는 현상이 있습니다.
- 이를 해결하기 위해 파이프라인 전반에서 `RapidOCR` 초기화 시 반드시 **한국어 모델**(`LangRec.KOREAN`, `EngineType.ONNXRUNTIME`, `OCRVersion.PPOCRV5`)을 명시적으로 사용하도록 통일하여 한글 가사 BBox를 완벽하게 탐지 및 마스킹합니다.
