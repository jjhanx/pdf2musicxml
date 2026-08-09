import { useCallback, useEffect, useState } from 'react';

type DeskewAngle = {
  page_number: number;
  angle: number;
};

type Props = {
  jobId: string;
  onContinue: () => void;
};

export function DeskewPreviewPanel({ jobId, onContinue }: Props) {
  const [angles, setAngles] = useState<DeskewAngle[]>([]);
  const [processingPhase, setProcessingPhase] = useState<'idle' | 'polling' | 'done'>('idle');
  const [pollIntervalId, setPollIntervalId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const loadAngles = useCallback(async () => {
    const r = await fetch(`/api/deskew/${jobId}`, { cache: 'no-store' });
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `HTTP ${r.status}`);
    }
    const data = (await r.json()) as DeskewAngle[];
    setAngles(data);
  }, [jobId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setErr('');
      try {
        await loadAngles();
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAngles]);

  const pageCount = angles.length || 1;
  const currentAngleInfo = angles.find((a) => a.page_number === page);
  const currentAngle = currentAngleInfo ? currentAngleInfo.angle : 0;

  const handleAngleChange = (newAngle: number) => {
    setAngles((prev) =>
      prev.map((a) => (a.page_number === page ? { ...a, angle: newAngle } : a))
    );
  };

  useEffect(() => {
    return () => {
      if (pollIntervalId) window.clearInterval(pollIntervalId);
    };
  }, [pollIntervalId]);

  const submitAngles = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await fetch(`/api/deskew/${jobId}/continue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(angles),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      
      setProcessingPhase('polling');
      
      const interval = window.setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/job/${jobId}`);
          if (statusRes.ok) {
            const jobData = await statusRes.json();
            if (jobData.status === 'part_labels_needed') {
              window.clearInterval(interval);
              setProcessingPhase('done');
              setBusy(false);
            }
          }
        } catch(err) {}
      }, 1000);
      setPollIntervalId(interval as unknown as number);
      
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const imgSrc = `/api/deskew/${jobId}/page/${page}/png`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
        <h2>수평 보정 (Deskew)</h2>
        <div style={{ flex: 1 }} />
        {processingPhase === 'idle' && (
          <button onClick={submitAngles} disabled={busy} style={{ padding: '8px 16px', background: '#007bff', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            적용 및 결과 생성
          </button>
        )}
        {processingPhase === 'polling' && (
          <span style={{ color: '#007bff', fontWeight: 'bold' }}>결과 PDF 생성 중... (수 초 소요)</span>
        )}
        {processingPhase === 'done' && (
          <>
            <a
              href={`/api/deskew/${jobId}/pdf`}
              download={`deskewed-${jobId}.pdf`}
              className="btn-link"
              style={{ color: '#10b981', textDecoration: 'underline', marginRight: '1rem', fontSize: '0.9rem' }}
              title="수평보정된 원본 PDF (가사 포함)"
            >
              수평보정 원본 PDF 다운로드
            </a>
            <button onClick={() => onContinue()} style={{ padding: '8px 16px', background: '#28a745', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              다음 단계로 이동
            </button>
          </>
        )}
      </div>

      {err && <div style={{ color: 'red', marginBottom: '1rem' }}>{err}</div>}

      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: '1rem' }}>
        <div style={{ width: '250px', overflowY: 'auto', borderRight: '1px solid #ccc', paddingRight: '1rem' }}>
          <h3>페이지 목록</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {angles.map((a) => (
              <button
                key={a.page_number}
                onClick={() => setPage(a.page_number)}
                style={{
                  padding: '0.5rem',
                  textAlign: 'left',
                  background: page === a.page_number ? '#e0f0ff' : '#fff',
                  color: '#000',
                  border: '1px solid #ccc',
                  cursor: 'pointer',
                  borderRadius: '4px'
                }}
              >
                Page {a.page_number} (각도: {a.angle}°)
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <strong>현재 페이지 회전 각도:</strong>
              <input
                type="range"
                min="-10"
                max="10"
                step="0.1"
                value={currentAngle}
                onChange={(e) => handleAngleChange(parseFloat(e.target.value))}
                style={{ flex: 1, maxWidth: '300px' }}
              />
              <span>{currentAngle}°</span>
              <button onClick={() => handleAngleChange(0)} style={{ padding: '4px 8px' }}>0° 리셋</button>
            </label>
          </div>

          <div
            style={{
              flex: 1,
              overflow: 'hidden',
              background: '#f0f0f0',
              border: '1px solid #ccc',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <img
              src={imgSrc}
              alt={`Page ${page}`}
              style={{
                transform: `rotate(${currentAngle}deg)`,
                transformOrigin: 'center center',
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
                background: 'white',
                transition: 'transform 0.1s ease-out'
              }}
            />
            {/* 수평 가이드라인 (더 선명하게) */}
            <div style={{ position: 'absolute', top: '25%', left: 0, width: '100%', borderTop: '2px solid red', boxShadow: '0 0 2px #000', pointerEvents: 'none', opacity: 0.8 }} />
            <div style={{ position: 'absolute', top: '50%', left: 0, width: '100%', borderTop: '2px solid red', boxShadow: '0 0 2px #000', pointerEvents: 'none', opacity: 0.8 }} />
            <div style={{ position: 'absolute', top: '75%', left: 0, width: '100%', borderTop: '2px solid red', boxShadow: '0 0 2px #000', pointerEvents: 'none', opacity: 0.8 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
