# 이미지 PDF 처리 가이드

- 기존 벡터 PDF 처리 외에 이미지 스캔본 PDF를 처리하는 파이프라인 추가.
- RapidOCR을 이용해 텍스트와 좌표 추출 (image_pdf_processor.py)
- 추출된 BBox로 PDF 마스킹 (clean_score_only.pdf 생성)
- UI에서 Vector PDF와 Image PDF 중 선택 가능
