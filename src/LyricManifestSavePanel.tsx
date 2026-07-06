import { useCallback, useEffect, useState } from 'react';

type ManifestSummary = {
  originalName?: string;
  itemCount: number;
  matchStats?: Record<string, unknown> | null;
  version?: number;
};

type Props = {
  jobId: string;
  onContinue: () => void;
};

export function LyricManifestSavePanel({ jobId, onContinue }: Props) {
  const [summary, setSummary] = useState<ManifestSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setErr('');
      try {
        const r = await fetch(`/api/lyric-manifest/${jobId}`, { cache: 'no-store' });
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `HTTP ${r.status}`);
        }
        const data = (await r.json()) as ManifestSummary;
        if (!cancelled) setSummary(data);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const continueFlow = useCallback(async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await fetch(`/api/lyric-manifest/${jobId}/continue`, { method: 'POST' });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      onContinue();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [jobId, onContinue]);

  const stats = summary?.matchStats;

  return (
    <div className="font-strip-panel lyric-manifest-save-panel">
      <div>
        <h2 style={{ margin: '0 0 0.5rem' }}>분리된 가사 저장 (lyric_manifest.json)</h2>
        <p className="font-strip-muted" style={{ margin: 0, fontSize: '0.92rem', lineHeight: 1.5 }}>
          pdfplumber·PyMuPDF 추출 결과가 <strong>lyric_manifest.json</strong>(v3)으로 병합되었습니다.{' '}
          <strong>2단계 이어하기</strong>에 쓸 수 있도록 지금 저장해 두세요. OMR이 끝난 뒤 가사 검증 UI에서
          내용을 다시 다듬을 수 있습니다.
        </p>
        {summary ? (
          <p className="font-strip-muted" style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>
            항목 <strong>{summary.itemCount}</strong>개
            {stats ?
              <>
                {' '}
                · pdfplumber {String(stats.pdfplumberLines ?? '?')}줄 · PyMuPDF{' '}
                {String(stats.pymupdfItems ?? '?')}항목 · 양쪽 매칭 {String(stats.mergedFromBoth ?? '?')}
              </>
            : null}
          </p>
        ) : null}
      </div>

      {err ? <div className="status err">{err}</div> : null}
      {!summary && !err ? <div className="status">manifest 불러오는 중…</div> : null}

      {summary ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.5rem' }}>
          <a
            className="btn-secondary"
            style={{ textDecoration: 'none', padding: '0.55rem 0.9rem', fontWeight: 600 }}
            href={`/api/lyric-manifest/${jobId}/download`}
          >
            lyric_manifest.json 저장
          </a>
          <a
            className="btn-secondary"
            style={{ textDecoration: 'none', padding: '0.55rem 0.9rem' }}
            href={`/api/diagnostic/${jobId}/clean-score-pdf?download=1`}
          >
            clean_score PDF 저장
          </a>
        </div>
      ) : null}

      <div className="row" style={{ gap: '0.75rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
        <button type="button" disabled={busy || !summary} onClick={() => void continueFlow()}>
          {busy ? '처리 중…' : '저장 완료 — OMR로 계속'}
        </button>
      </div>
    </div>
  );
}
