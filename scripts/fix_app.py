import sys

def main():
    try:
        with open('d:\\pdf2musicxml\\src\\App.tsx', 'r', encoding='utf-8') as f:
            content = f.read()
    except:
        return
        
    # State addition
    if "const [reviewProcessingPhase" not in content:
        content = content.replace(
            "const [reviewingJobId, setReviewingJobId] = useState<string | null>(null);",
            "const [reviewingJobId, setReviewingJobId] = useState<string | null>(null);\n  const [reviewProcessingPhase, setReviewProcessingPhase] = useState<'idle' | 'polling' | 'done'>('idle');\n  const [reviewPollIntervalId, setReviewPollIntervalId] = useState<number | null>(null);"
        )

    # useEffect addition
    if "if (reviewPollIntervalId) window.clearInterval(reviewPollIntervalId);" not in content:
        content = content.replace(
            "tasksRef.current = tasks;\n\n  useEffect(() => {",
            "tasksRef.current = tasks;\n\n  useEffect(() => {\n    return () => {\n      if (reviewPollIntervalId) window.clearInterval(reviewPollIntervalId);\n    };\n  }, [reviewPollIntervalId]);\n\n  useEffect(() => {"
        )

    # submitReview modification
    submit_target = '''      if (reviewOriginalFileName) {
         localStorage.removeItem('pdf2mxl_review_' + reviewOriginalFileName);
      }
      setReviewingJobId(null);
      setReviewAfterOmr(false);
      setReviewData([]);
      setManualLyricRects([]);
      setLyricReviewUndo(null);
      setFocusedReviewRowIndex(null);
      setReviewOriginalFileName('');
      setHasSavedData(false);
    } catch (e) {'''
    
    submit_replace = '''      if (reviewOriginalFileName) {
         localStorage.removeItem('pdf2mxl_review_' + reviewOriginalFileName);
      }
      setReviewProcessingPhase('polling');
      const interval = window.setInterval(async () => {
        try {
          const statusRes = await fetch(/api/job/\\);
          if (statusRes.ok) {
            const jobData = await statusRes.json();
            if (jobData.status === 'lyric_manifest_save_needed') {
              window.clearInterval(interval);
              setReviewProcessingPhase('done');
            }
          }
        } catch(err) {}
      }, 1000);
      setReviewPollIntervalId(interval as unknown as number);
    } catch (e) {'''
    
    content = content.replace(submit_target, submit_replace)
    
    # finishReviewProcess addition
    finish_target = '''  const submitContinueOmrStaffReview = async () => {'''
    finish_replace = '''  const finishReviewProcess = () => {
    setReviewingJobId(null);
    setReviewAfterOmr(false);
    setReviewData([]);
    setManualLyricRects([]);
    setLyricReviewUndo(null);
    setFocusedReviewRowIndex(null);
    setReviewOriginalFileName('');
    setHasSavedData(false);
    setReviewProcessingPhase('idle');
  };

  const submitContinueOmrStaffReview = async () => {'''
    
    content = content.replace(finish_target, finish_replace)

    # Button UI
    button_target = '''            <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={submitReview} style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', background: '#1976d2', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                {reviewAfterOmr
                  ? '검증 완료 · 가사 주입 계속'
                  : pipelineMode === 'font_separator'
                    ? '병합 후 OMR 실행'
                    : 'OMR 실행 (악보 인식 시작)'}
              </button>
            </div>'''
            
    button_replace = '''            <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '1rem' }}>
              {reviewProcessingPhase === 'idle' && (
                <button onClick={submitReview} style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', background: '#1976d2', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                  적용 및 결과 생성
                </button>
              )}
              {reviewProcessingPhase === 'polling' && (
                <span style={{ color: '#007bff', fontWeight: 'bold' }}>결과 PDF 생성 중... (수 초 소요)</span>
              )}
              {reviewProcessingPhase === 'done' && (
                <>
                  <a
                    href={/api/deskew/\\/clean-score-pdf}
                    download={clean-score-\\.pdf}
                    className="btn-link"
                    style={{ color: '#f59e0b', textDecoration: 'underline', fontWeight: 'bold', fontSize: '1rem' }}
                    title="가사가 제거된 Clean Score PDF"
                  >
                    Clean Score PDF 다운로드
                  </a>
                  <button onClick={finishReviewProcess} style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', background: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                    다음 단계로 이동
                  </button>
                </>
              )}
            </div>'''
            
    content = content.replace(button_target, button_replace)
    
    with open('d:\\pdf2musicxml\\src\\App.tsx', 'w', encoding='utf-8') as f:
        f.write(content)

if __name__ == '__main__':
    main()