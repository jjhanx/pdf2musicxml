import { useCallback, useEffect, useState } from 'react';

type PreviewSummary = {
  pageCount: number;
  originalName?: string;
  ranges?: Array<{ minPt: number; maxPt: number; label?: string }>;
  replaceTripletPua?: boolean;
};

type Props = {
  jobId: string;
  onContinue: () => void;
  onRedoFontStrip: () => void;
};

export function CleanScorePreviewPanel({ jobId, onContinue, onRedoFontStrip }: Props) {
  const [summary, setSummary] = useState<PreviewSummary | null>(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const dpi = 156;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setErr('');
      try {
        const r = await fetch(`/api/clean-score-preview/${jobId}`, { cache: 'no-store' });
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `HTTP ${r.status}`);
        }
        const data = (await r.json()) as PreviewSummary;
        if (!cancelled) setSummary(data);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const pageCount = Math.max(1, summary?.pageCount ?? 1);
  const origSrc = `/api/clean-score-preview/${jobId}/page/${page}/png?source=original&dpi=${dpi}`;
  const cleanSrc = `/api/clean-score-preview/${jobId}/page/${page}/png?source=clean_score&dpi=${dpi}`;

  const continueFlow = useCallback(async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await fetch(`/api/clean-score-preview/${jobId}/continue`, { method: 'POST' });
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

  const redoFontStrip = useCallback(async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await fetch(`/api/clean-score-preview/${jobId}/redo-font-strip`, { method: 'POST' });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      onRedoFontStrip();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [jobId, onRedoFontStrip]);

  const rangeText =
    summary?.ranges?.length ?
      summary.ranges.map((r) => `${r.minPt}–${r.maxPt}pt`).join(', ')
    : '(알 수 없음)';

  return (
    <div className="font-strip-panel clean-score-preview-panel">
      <div>
        <h2 style={{ margin: '0 0 0.5rem' }}>clean_score_only.pdf 확인</h2>
        <p className="font-strip-muted" style={{ margin: 0, fontSize: '0.92rem', lineHeight: 1.5 }}>
          Audiveris에 넣기 전 <strong>원본</strong>과 <strong>clean_score</strong>를 나란히 확인하세요.{' '}
          <strong>음표 머리·오선·조표</strong>가 사라졌으면 「폰트 범위 다시 선택」으로 pt 범위를 좁히세요.{' '}
          (22.8pt 등 SMuFL 음표 글림은 제거 범위에 넣지 마세요.)
        </p>
        <p className="font-strip-muted" style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>
          적용한 제거 범위: <strong>{rangeText}</strong>
          {summary?.replaceTripletPua ?
            ' · U+F073→3 치환 켜짐'
          : ' · U+F073→3 치환 꺼짐(기본, 음표 머리 보호)'}
        </p>
      </div>

      {err ? <div className="status err">{err}</div> : null}
      {!summary && !err ? <div className="status">미리보기 불러오는 중…</div> : null}

      {summary ? (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            <span style={{ fontWeight: 600 }}>페이지</span>
            <button type="button" disabled={page <= 1 || busy} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              ◀
            </button>
            <span style={{ fontWeight: 600 }}>
              {page} / {pageCount}
            </span>
            <button
              type="button"
              disabled={page >= pageCount || busy}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            >
              ▶
            </button>
            <a
              className="btn-secondary"
              style={{ marginLeft: '0.5rem', textDecoration: 'none', padding: '0.45rem 0.75rem' }}
              href={`/api/clean-score-preview/${jobId}/pdf`}
              target="_blank"
              rel="noreferrer"
            >
              clean_score PDF 새 탭
            </a>
            <a
              className="btn-secondary"
              style={{ textDecoration: 'none', padding: '0.45rem 0.75rem' }}
              href={`/api/clean-score-preview/${jobId}/pdf?download=1`}
            >
              clean_score PDF 저장
            </a>
          </div>

          <div className="clean-score-preview-row">
            <div className="clean-score-preview-col">
              <div className="clean-score-preview-label">원본 PDF · p.{page}</div>
              <div className="clean-score-preview-frame">
                <img alt={`원본 페이지 ${page}`} src={origSrc} />
              </div>
            </div>
            <div className="clean-score-preview-col">
              <div className="clean-score-preview-label">clean_score_only.pdf · p.{page}</div>
              <div className="clean-score-preview-frame">
                <img alt={`clean_score 페이지 ${page}`} src={cleanSrc} />
              </div>
            </div>
          </div>

          <div className="row" style={{ gap: '0.75rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
            <button type="button" disabled={busy} onClick={() => void continueFlow()}>
              {busy ? '처리 중…' : '확인 — Audiveris로 계속'}
            </button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => void redoFontStrip()}>
              폰트 범위 다시 선택
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
