import os
doc_path = 'docs/악보_변환_품질_가이드.md'
with open(doc_path, 'rb') as f:
    data = f.read()
text = data.decode('cp949', errors='replace')
new_section = '''
### 4. [NEW] 이미지 PDF 모드 가사 마스킹 HITL 활용
이미지 PDF(예: 스캔본, JPG 등)를 OMR로 변환할 때, OMR 엔진이 가사를 음표로 오인하거나 악보 요소(오선, 음표 등)를 가사로 오인하여 지워버리면 치명적인 인식 오류가 발생합니다.

- **방법**: 파이프라인 시작 시 좌측 하단의 **"가사 마스킹 및 텍스트 영역 검증·편집 (HITL)"** 옵션을 켜두세요(기본 켜짐).
- **효과**: OCR 텍스트 추출이 끝난 직후 파이프라인이 **일시 정지(PAUSE)**되며, 화면에 추출된 가사 박스들이 오버레이되어 나타납니다.
- **수동 개입 요령**:
  1. 음표(Note), 오선(Staff), 꼬리(Beam) 등을 가리고 있는 박스가 있다면 해당 박스를 **클릭하여 삭제**합니다.
  2. 반대로 가사가 추출되지 않은 부분이 있다면 **드래그하여 새 박스를 추가**합니다.
  3. 완료 후 "다음 단계 진행"을 누르면, 사용자가 승인한 정확한 영역만 하얗게 지워진 clean_score.pdf가 만들어져 OMR 엔진으로 전달됩니다.
- 이 과정을 통해 OMR 엔진 크래시를 방지하고 인식 품질을 비약적으로 높일 수 있습니다.
'''
if '이미지 PDF 모드' not in text:
    text += new_section

with open(doc_path, 'w', encoding='utf-8') as f:
    f.write(text)
print('done')
