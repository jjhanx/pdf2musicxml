# 이미지 PDF 처리 가이드

- 기존 벡터 PDF 처리 외에 이미지 스캔본 PDF를 처리하는 파이프라인 추가.
- RapidOCR을 이용해 텍스트와 좌표 추출 (image_pdf_processor.py)
- 추출된 BBox로 PDF 마스킹 (clean_score_only.pdf 생성)
- UI에서 Vector PDF와 Image PDF 중 선택 가능

- UI에서 기본으로 자동 판별(Auto) 모드를 지원하여 업로드된 PDF가 이미지 기반인지(텍스트 50자 미만) 텍스트 기반인지 검사 후 적절한 모드로 자동 라우팅합니다.
