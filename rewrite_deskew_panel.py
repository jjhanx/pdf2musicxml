import sys
with open('src/DeskewPreviewPanel.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

# Add states
state_injection = "  const [angles, setAngles] = useState<DeskewAngle[]>([]);\n  const [processingPhase, setProcessingPhase] = useState<'idle' | 'polling' | 'done'>('idle');\n  const [pollIntervalId, setPollIntervalId] = useState<number | null>(null);"
text = text.replace("  const [angles, setAngles] = useState<DeskewAngle[]>([]);", state_injection)

# Replace submitAngles
old_submit = """  const submitAngles = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await fetch(/api/deskew//continue, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(angles),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? HTTP );
      }
      onContinue();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };"""

new_submit = """  useEffect(() => {
    return () => {
      if (pollIntervalId) window.clearInterval(pollIntervalId);
    };
  }, [pollIntervalId]);

  const submitAngles = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await fetch(/api/deskew//continue, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(angles),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? HTTP );
      }
      
      setProcessingPhase('polling');
      
      const interval = window.setInterval(async () => {
        try {
          const statusRes = await fetch(/api/job/);
          if (statusRes.ok) {
            const jobData = await statusRes.json();
            if (jobData.status === 'part_labels_needed') {
              window.clearInterval(interval);
              setProcessingPhase('done');
              setBusy(false);
            }
          }
        } catch(err) {}
      }, 2000);
      setPollIntervalId(interval);
      
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };"""

text = text.replace(old_submit, new_submit)

# Update buttons
old_button_section = """        <div style={{ flex: 1 }} />
        <button onClick={submitAngles} disabled={busy} style={{ padding: '8px 16px', background: '#007bff', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          적용 및 다음 단계로
        </button>
      </div>"""

new_button_section = """        <div style={{ flex: 1 }} />
        {processingPhase === 'idle' && (
          <button onClick={submitAngles} disabled={busy} style={{ padding: '8px 16px', background: '#007bff', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            적용 및 결과 생성
          </button>
        )}
        {processingPhase === 'polling' && (
          <span style={{ color: '#007bff', fontWeight: 'bold' }}>결과 PDF 생성 중... (최대 1분 소요)</span>
        )}
        {processingPhase === 'done' && (
          <>
            <a
              href={/api/deskew//pdf}
              download={deskewed-.pdf}
              className="btn-link"
              style={{ color: '#10b981', textDecoration: 'underline', marginRight: '1rem', fontSize: '0.9rem' }}
              title="수평보정된 원본 PDF (가사 포함)"
            >
              수평보정 원본 PDF 다운로드
            </a>
            <a
              href={/api/deskew//clean-score-pdf}
              download={clean-score-.pdf}
              className="btn-link"
              style={{ color: '#f59e0b', textDecoration: 'underline', marginRight: '1rem', fontSize: '0.9rem' }}
              title="가사가 제거된 수평보정 PDF"
            >
              Clean Score PDF 다운로드
            </a>
            <button onClick={() => onContinue()} style={{ padding: '8px 16px', background: '#28a745', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              다음 단계로 이동
            </button>
          </>
        )}
      </div>"""

text = text.replace(old_button_section, new_button_section)

with open('src/DeskewPreviewPanel.tsx', 'w', encoding='utf-8') as f:
    f.write(text)

print("Rewrote DeskewPreviewPanel successfully")
