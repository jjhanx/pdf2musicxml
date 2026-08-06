import pathlib

p = pathlib.Path('docs/AI_OMR_엔진.md')
if p.exists():
    content = p.read_text('utf-8')
    add_text = """
## 7. 트러블슈팅 및 일반적 해결책 (General Solutions)

### Windows 환경에서 Python 인코딩(UnicodeDecodeError) 오류 방지
- **문제**: `homr` 백엔드 등에서 `musicxml` 라이브러리가 XML을 로드할 때, Windows의 기본 인코딩(`cp949`)을 사용하여 파싱하다가 `UnicodeDecodeError`가 발생할 수 있습니다.
- **일반적 해결책**: Node.js 서버(`server/index.ts`) 및 `shared/omr.ts`에서 Python 서브프로세스를 생성할 때 `PYTHONUTF8='1'` 환경 변수를 강제 주입하여, 모든 Python 파일 I/O가 `utf-8`을 기본값으로 사용하도록 보장합니다.

### OMR 엔진 로그 디버깅
- **문제**: OMR 엔진(`homr`, `tromr`, `Audiveris` 등)이 백그라운드에서 실패했을 때 에러 원인을 추적하기 어렵습니다.
- **일반적 해결책**: `server/index.ts`에서 OMR 엔진 실행 후 `stdout`과 `stderr`를 `omr_engine.log` 파일로 세션 디렉토리에 저장합니다. 사용자는 UI에서 '디버그 ZIP 다운로드'를 클릭하여 해당 로그 파일을 직접 확인할 수 있으며, 실패 시 에러 메시지에도 이 로그를 확인하도록 안내합니다.

### UI 내 활성 OMR 엔진 표시
- **문제**: OMR 품질 검토(HITL) 단계에 진입했을 때, 현재 페이지가 어떤 OMR 엔진으로 변환된 결과인지 식별하기 어렵습니다.
- **일반적 해결책**: API 렌더링 시 `activeOmrEngine` 상태를 `summary` 엔드포인트 응답에 추가하고, `OmrStaffReviewPanel` 컴포넌트 헤더에 뱃지(예: `AI OMR`, `PDFtoMusic Pro`, `Audiveris`)를 띄워 변환 출처를 명확히 안내합니다.
"""
    if '트러블슈팅 및 일반적 해결책' not in content:
        p.write_text(content + add_text, 'utf-8')
