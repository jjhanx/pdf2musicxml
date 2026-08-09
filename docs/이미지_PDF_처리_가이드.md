# 이미지 PDF 처리 가이드

- 기존 벡터 PDF 처리 외에 이미지 스캔본 PDF를 처리하는 파이프라인 추가.
# 이미지 PDF 처리 가이드

- 기존 벡터 PDF 처리 외에 이미지 스캔본 PDF를 처리하는 파이프라인 추가.
- RapidOCR을 이용해 텍스트와 좌표 추출 (image_pdf_processor.py)
- 추출된 BBox 및 수동 마스킹 영역으로 PDF 마스킹 (clean_score_only.pdf 생성)
- UI에서 기본으로 자동 판별(Auto) 모드를 지원하여 업로드된 PDF가 이미지 기반인지(텍스트 50자 미만) 텍스트 기반인지 검사 후 적절한 모드로 자동 라우팅합니다.

### OMR 엔진 고정 정책 (General Solution)
- 기존에는 이미지 PDF에 대해 AI OMR을 우선 적용하려는 시도가 있었으나, 최종 결과물의 품질 및 박자/빔 처리의 안정성을 위해 **모든 PDF(Vector/Image) 처리는 오직 Audiveris 엔진 하나만 사용**하도록 프로세스가 통일되었습니다.
- 사용자는 어떤 유형의 PDF를 업로드하더라도 동일하게 Audiveris 기반의 MusicXML 변환 파이프라인을 거칩니다.

### 한글 가사 마스킹 정책 (General Solution - Tesseract 병행 도입)
- Image PDF의 BBox 추출을 담당하는 `RapidOCR` 엔진은 기본 설정(영/중) 시 한글 제목이나 가사를 제대로 잡아내지 못해 텍스트 박스 추출에서 아예 누락되거나 쓰레기 문자(Garbage)로 인식하는 현상이 있습니다.
- 이로 인해 `clean_score_only.pdf`에 제목과 한글 가사 찌꺼기가 지워지지 않고 남는 문제가 발생했습니다.
- **개선 상태 (General Solution)**: 한국어 인식률을 극대화하기 위해 `image_pdf_processor.py`에 **Tesseract OCR (kor+eng)** 추출 로직을 추가로 도입했습니다. RapidOCR이 1차로 영문/기호 BBox를 추출하고, Tesseract가 2차로 한글과 기타 누락된 텍스트의 BBox를 찾아내어 두 결과를 병합(Merge)합니다. 이를 통해 악보의 제목과 한글 가사가 찌꺼기 없이 깨끗하게 마스킹되도록 파이프라인 안정성을 대폭 개선했습니다. (단, 런타임 환경에 `tesseract-ocr` 및 `tesseract-ocr-kor` 시스템 패키지와 파이썬의 `pytesseract` 라이브러리가 필요합니다)

## [General Solution] 스캔/이미지 PDF의 수동 마스킹 영구 삭제 방식 도입
- **문제점**: 텍스트가 없는 스캔 이미지 기반 PDF를 처리할 때, 사용자가 UI에서 가사를 지우기 위해 분홍색 박스(수동 마스킹)를 쳐도 Audiveris가 렌더링한 이미지에서는 가사가 그대로 남아있는 문제가 있었습니다. PyMuPDF의 `draw_rect`(하얀 벡터 사각형 그리기)를 사용하면, 원본 이미지 레이어 위에 그려지긴 하지만 백엔드(Audiveris) 렌더러가 이를 무시하거나 이미지 뒤로 숨겨버려 악보 인식을 망가뜨리는 원인이 되었습니다.
- **해결책**: 수동 마스킹 영역을 처리할 때 단순한 그리기(`draw_rect`) 대신 정식 리덕션 방식인 `add_redact_annot(..., fill=(1,1,1))` 후 `apply_redactions()`를 일괄 호출하도록 `mask_pdf.py`를 변경했습니다. 이 방식은 백그라운드 이미지의 픽셀 자체를 오려내고(지우고) 해당 영역을 흰색으로 영구적으로 덮어씌웁니다. 
- 결과적으로 벡터 텍스트가 있든 없든(Image/Vector PDF 불문), 수동으로 지정한 모든 영역의 픽셀 정보가 완전히 삭제된 상태로 `clean_score_only.pdf`가 생성되므로 Audiveris의 인식 오류(Bar line 오인 등)가 근본적으로 차단됩니다.
- **Image PDF 통합 마스킹 적용 (General Solution)**: 기존에는 Image PDF의 경우 `image_pdf_processor.py mask`라는 별도 로직을 타면서 수동 마스킹(Pink Box) 데이터(`ocr_data.json`)가 누락되는 버그가 있었습니다. 현재는 모든 Image/Vector 파이프라인에서 수동 박스 정보가 담긴 `ocr_data.json`과 원본 PDF를 받아 `mask_pdf.py` 하나로 통일되게 마스킹하도록 변경했습니다. 이를 통해 스캔본 이미지라도 사용자가 핑크 박스를 친 영역은 완벽하게 리덕션 처리되어 Audiveris 엔진으로 넘어갑니다.
- **Image PDF  ŷ(Manual Masking)  ذ (General Solution)**: image_pdf_processor.py mask_pdf.py ŷ   ѱ , ڰ PyMuPDF UI  ׷ȴ ũ ؽƮ  ڽ(Manual Rects) (_manual_lyric_mask) clean_score_only.pdf  ݿ ʴ ġ װ ߰ߵǾϴ.   mask_pdf.py Image PDF ŷ   Ǵ lyric_selective = False   ڵ  _manual_lyric_mask о̴ ݺ Ѳ ŵ(Skip)    ־ Դϴ.
- **ذå**: mask_pdf.py  ŷ ó   if lyric_selective and not _env_falsy("MASK_PDF_MANUAL_LYRIC_MASK"):  if not _env_falsy("MASK_PDF_MANUAL_LYRIC_MASK"): Ͽ, lyric_selective (/ؽƮ PDF) ο  ڰ  簢  (Unconditionally) о 鿩 ȼ (Redaction) ϵ Ϲ(General) ذå ߽ϴ. ̸  ̹  Ǻ UI ũ ڽ ġ ش κ Ϻϰ ȭƮ ƿ(White Out)Ǿ OMR ν    ֽϴ.
- **Audiveris ν  Image PDF ȼ    ذ (General Solution)**: Image PDF   ڰ ׸ ڽ(Ǵ ڵ  ؽƮ ڽ) ȭ 󿡼 Ͼ  ó ,  (Audiveris) Ѿ 簡  ʰ  ״  ִ ġ ׸ ذ߽ϴ.
- **ذå**:  mask_pdf.py ̹ PDF ó   ؽƮ ٴ   ڽ ܼ ׸(draw_rect)  white_rects 迭 Ȱ,  (pply_redactions) Ǵ ⺻ ̹ ȼ ǵ帮 ʵ images=0 Ǿ ־ Դϴ. ̸ ذϱ  ̹ PDF(lyric_selective = False) 쿡  ڽ  edact_rects , pply_redactions ȣ  img_redact=2(PDF_REDACT_IMAGE_PIXELS) ɼ ־ ** PDF  ̹ ȼ  ü  쵵** Ϲ(General) ذå ߽ϴ.
- **[߰] 鿣  Image PDF  ȯ    (General Solution)**: ̽ ũƮ   鿣(server/index.ts) Image PDF  mask_pdf.py  , MASK_PDF_LYRIC_SELECTIVE=0 ȯ  ƿ ѱ ʰ ־ϴ. ̷  ũƮ ο Ʈ  lyric_selective = True( PDF ) Ͽ ȼ Ⱑ ȰȭǴ  װ ־ϴ. 鿣 exec ȣ  ȯ   Ͽ 鿣   Ϻ General Solution ߽ϴ.
- **[] UI  Ͱ  Ͽ Ǵ Ȧ(Blackhole)   (General Solution)**: ڰ UI  ڽ ġ 'Ϸ'   鿣 /api/review/:jobId Ʈ ͸ ϴ  (ocr_data.json),  ٽ 簳Ǹ鼭 ͸ о̴  (ocr_data_pymupdf.json)  ޶ϴ. ̷  ڰ ֽ ׸  ŷ Ͱ  ǵǰ, 鿣 ʱ   ([]) о   ϴ ġ  Ȧ װ ־ϴ. ̸ ذϱ  /api/review/:jobId ̹ PDF 忡 ׻  ϴ ocr_data_pymupdf.json ͸ ϵ ȭϿ Ϻ General Solution ߽ϴ.

##   (Deskew)  HITL ˼ 

̹ PDF (ĵ Ǻ ) ĵ  ణ  Ǻ ̹  ߻մϴ. Audiveris ü    Ƿ, OMR ν  ̸ (Deskew)ϴ ó  ʼԴϴ.

###  
1. **ڵ  м**: deskew_processor.py analyze ũƮ  OpenCV HoughLinesP ̿Ͽ (Staff Lines)  Žմϴ.
2. **HITL   (Deskew Preview Panel)**:  UI ڿ Ž  ϰ, ̴    ȸ  ̼   ִ ȸ մϴ.
3. **ȸ **: ڰ ϸ deskew_processor.py apply ũƮ cv2.warpAffine ̿ ̹    ο deskewed.pdf մϴ.
4. ** **:  deskewed.pdf Է   ( , OMR ) մϴ.

###  ȿ
- Audiveris   ǥ νķ  
- ĵ  ǰ   ó  Ȯ

### UI   ǰ (General Solution)
- ** **: UI Ʈ(DeskewPreviewPanel )     ؽƮ  (: #000) Ͽ  ؾ մϴ.
- **̹  **: PDF  Ϸ  , ػ󵵰   ˾ƺ   ϱ    (Zoom Factor) ּ 2.0 ̻ ؾ մϴ.  UI max-width, max-height 100% ϰ  â ũ⸦ ȭ ũ⿡ °     ϵ մϴ.
