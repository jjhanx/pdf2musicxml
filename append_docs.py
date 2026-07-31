import sys

doc_path = r'd:\pdf2musicxml\docs\악보_변환_품질_가이드.md'
with open(doc_path, 'a', encoding='utf-8') as f:
    f.write("\n\n## UI/UX 및 가사 노이즈 필터링 개선 사항\n\n")
    f.write("### 1. UI/UX 드래그 앤 드롭 및 단계 선택 최적화\n")
    f.write("- **문제점**: 1단계 '원본 PDF'용 Drag & Drop 영역에 파일을 놓아도, 하단의 2~4단계 선택 영역에 있는 `<input type='file'>`들의 텍스트가 '선택된 파일 없음'으로 표기되어 드래그 앤 드롭이 실패한 것처럼 보이는 혼란이 발생.\n")
    f.write("- **일반적 해결책 (General Solution)**: `App.tsx`에서 `startStage`별로 UI 블록을 완벽하게 분리하여 각 단계에 필요한 파일 입력 필드만 보여주도록 개선. 불필요한 '선택된 파일 없음' 대신 '선택하지 않음'으로 표기 변경. 단계 하단에 중복 노출되던 설정 체크박스들을 하단 '고급 설정' 블록으로 통합.\n\n")
    f.write("### 2. 가사 노이즈 필터링 강화 및 RapidOCR 백엔드 통합\n")
    f.write("- **문제점**: 템포 마크(예: `=82j`), 악보 기호 찌꺼기(예: `G k`, `l l l l`, `f D`) 등이 가사로 추출되어 OMR HITL 리뷰 시 방해가 됨.\n")
    f.write("- **일반적 해결책 (General Solution)**: \n")
    f.write("  - `merge_lyric_sources.py`의 `is_meaningless_noise` 함수에 `re.search(r'(=|≈)\\s*\\d+', text)`를 추가하여 템포 마크 등을 식별 및 필터링.\n")
    f.write("  - 1글자로 이루어진 찌꺼기 단어들에 대한 조건 C, D 로직을 강화하여 `G k` 등 비정상 단어 조합을 차단.\n")
    f.write("  - 이미지 PDF 기반 추출(`extract_text.py` 내 `extract_image`) 시에도 `is_meaningless_noise`를 통과하도록 동일한 필터링 로직을 주입. 이를 통해 Vector 및 Image PDF 전반에서 찌꺼기 가사 노출을 원천적으로 차단.\n")

print("Docs updated")
