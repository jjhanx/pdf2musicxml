import pathlib

p1 = pathlib.Path('docs/이미지_PDF_처리_가이드.md')
if p1.exists():
    c1 = p1.read_text('utf-8')
    addition1 = """
## [General Solution] AI OMR용 마스킹 최적화
이미지 PDF 처리 시 기존에는 가사를 하얀색 박스로 지우는 과정(masking)을 거쳤으나, 이는 악보 기호(오선, 음표 등)까지 파괴하는 문제가 있었습니다. 
- **해결책**: AI OMR(homr 등)은 딥러닝 기반으로 학습되어 가사가 존재하더라도 악보 기호를 구분할 수 있습니다. 따라서 사용자가 `AI OMR`을 엔진으로 선택한 경우, 이미지 PDF에서 하얀색 마스킹 과정을 생략하고 원본(`original.pdf`)을 그대로 `clean_score.pdf`로 복사하여 전달하도록 개선되었습니다.
"""
    p1.write_text(c1 + addition1, 'utf-8')

p2 = pathlib.Path('docs/AI_OMR_엔진.md')
if p2.exists():
    c2 = p2.read_text('utf-8')
    addition2 = """
## [General Solution] SA / TB 합창 성부 지원 및 UI 개선
- **해결책 (성부 분류)**: 합창 악보에서 하나의 오선지에 소프라노와 알토가 묶인 `SA`, 테너와 베이스가 묶인 `TB` 형태를 지원하기 위해, `detect_parts.py`의 휴리스틱과 `src/partLabelOptions.ts`의 사전정의 목록에 `SA`, `TB`를 공식 추가했습니다.
- **해결책 (엔진 선택 UI)**: 고급 설정에 숨겨져 있고 특정 조건에서만 서버로 전송되던 OMR 엔진 선택(AI vs Audiveris) 라디오 버튼을 메인 화면으로 꺼내고 모드(벡터/이미지)에 관계없이 서버에 전달하도록 변경했습니다.
"""
    p2.write_text(c2 + addition2, 'utf-8')
