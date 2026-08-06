import pathlib
p = pathlib.Path('docs/AI_OMR_엔진.md')
if p.exists():
    content = p.read_text('utf-8')
    add_text = """
### OpenCV resize 시 크기 0에 의한 크래시 방지
- **문제**: `homr` 파이프라인에서 여백(margin)이나 스태프 영역이 아주 작게 인식될 경우, 캔버스 크기를 리사이징하는 계산 결과가 0 차원(`width`나 `height`가 0)으로 떨어질 수 있습니다. 이 상태로 `cv2.resize`를 호출하면 `error: (-215:Assertion failed) inv_scale_x > 0` 등의 에러가 발생하며 파이프라인이 즉시 중단됩니다.
- **일반적 해결책**: `scripts/run_homr.py`에서 `homr` 패키지를 로드하기 전에 전역적으로 `cv2.resize`를 몽키패치하여 전달받는 목표 크기(`dsize`)가 항상 최소 `(1, 1)` 이상이 되도록 보장합니다.
"""
    if 'OpenCV resize 시 크기 0에 의한 크래시 방지' not in content:
        p.write_text(content + add_text, 'utf-8')
