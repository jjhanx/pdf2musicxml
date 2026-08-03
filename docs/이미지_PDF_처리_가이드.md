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
