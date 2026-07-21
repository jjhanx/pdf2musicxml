import { useCallback, useEffect, useState } from 'react';

type PreviewSummary = {
  pageCount: number;
  originalName?: string;
  ranges?: Array<{ minPt: number; maxPt: number; label?: string }>;
  replaceTripletPua?: boolean;
  scoreTitle?: ScoreTitleState | null;
  titleCandidate?: ScoreTitleState | null;
};

type ScoreTitleState = {
  text: string;
  page?: number;
  bbox?: [number, number, number, number];
  fontSize?: number;
  detected?: boolean;
  mask?: boolean;
};

type Props = {
  jobId: string;
  onContinue: () => void;
  onRedoFontStrip: () => void;
};

function initialTitleText(summary: PreviewSummary | null): string {
  if (!summary) return '';
  return summary.scoreTitle?.text?.trim() || summary.titleCandidate?.text?.trim() || '';
}

export function CleanScorePreviewPanel({ jobId, onContinue, onRedoFontStrip }: Props) {
  const [summary, setSummary] = useState<PreviewSummary | null>(null);
  const [titleText, setTitleText] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [titleSaved, setTitleSaved] = useState(false);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [err, setErr] = useState('');
  const dpi = 156;

  const reloadSummary = useCallback(async () => {
    const r = await fetch(`/api/clean-score-preview/${jobId}`, { cache: 'no-store' });
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `HTTP ${r.status}`);
    }
    return (await r.json()) as PreviewSummary;
  }, [jobId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setErr('');
      try {
        const data = await reloadSummary();
        if (!cancelled) {
          setSummary(data);
          setTitleText(initialTitleText(data));
          setTitleSaved(Boolean(data.scoreTitle?.text?.trim()));
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, reloadSummary]);

  const pageCount = Math.max(1, summary?.pageCount ?? 1);
  const cacheBust = previewNonce > 0 ? `&_=${previewNonce}` : '';
  const origSrc = `/api/clean-score-preview/${jobId}/page/${page}/png?source=original&dpi=${dpi}${cacheBust}`;
  const cleanSrc = `/api/clean-score-preview/${jobId}/page/${page}/png?source=clean_score&dpi=${dpi}${cacheBust}`;

  const saveScoreTitle = useCallback(async () => {
    const text = titleText.trim();
    if (!text) {
      setErr('악보 제목을 입력하세요.');
      return false;
    }
    setBusy(true);
    setErr('');
    try {
      const r = await fetch(`/api/clean-score-preview/${jobId}/score-title`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          bbox: summary?.scoreTitle?.bbox ?? summary?.titleCandidate?.bbox,
          page: summary?.scoreTitle?.page ?? summary?.titleCandidate?.page ?? 1,
          applyMask: true,
        }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      const data = await reloadSummary();
      setSummary(data);
      setTitleSaved(true);
      setPreviewNonce((n) => n + 1);
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [jobId, reloadSummary, summary?.scoreTitle, summary?.titleCandidate, titleText]);

  const continueFlow = useCallback(async () => {
    setBusy(true);
    setErr('');
    try {
      if (titleText.trim() && !titleSaved) {
        const ok = await saveScoreTitle();
        if (!ok) return;
      }
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
  }, [jobId, onContinue, saveScoreTitle, titleSaved, titleText]);

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

  const candidateHint = summary?.titleCandidate?.text?.trim();
  const titleFontPt =
    summary?.scoreTitle?.fontSize ?? summary?.titleCandidate?.fontSize;

  return (
    <div className="font-strip-panel clean-score-preview-panel">
      <div>
        <h2 style={{ margin: '0 0 0.5rem' }}>clean_score_only.pdf 확인</h2>
        <p className="font-strip-muted" style={{ margin: 0, fontSize: '0.92rem', lineHeight: 1.5 }}>
          OMR에 넣기 전 <strong>원본</strong>과 <strong>clean_score</strong>를 나란히 확인하세요.{' '}
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

      {summary ? (
        <div
          className="clean-score-title-row"
          style={{
            marginTop: '0.75rem',
            padding: '0.75rem',
            border: '1px solid var(--border, #ccc)',
            borderRadius: 6,
            background: 'var(--panel-bg, #fafafa)',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>악보 제목 (MusicXML work-title)</div>
          <p className="font-strip-muted" style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', lineHeight: 1.45 }}>
            제목과 가사·악보가 <strong>같은 pt</strong>이면 폰트 제거만으로 제목 한글이 찌끄러질 수 있습니다.
            아래에 <strong>올바른 제목</strong>을 입력하고 「제목 영역 다시 지우기」로 clean_score 잔여 글자를
            제거하세요.
            {candidateHint ?
              <>
                {' '}
                OCR 후보: <em>{candidateHint}</em>
                {titleFontPt != null ? ` (${titleFontPt}pt)` : ''}
              </>
            : null}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="text"
              value={titleText}
              onChange={(e) => {
                setTitleText(e.target.value);
                setTitleSaved(false);
              }}
              placeholder="예: 청산에 살리라"
              style={{ flex: '1 1 12rem', minWidth: '10rem', padding: '0.45rem 0.6rem' }}
              disabled={busy}
            />
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => void saveScoreTitle()}>
              {busy ? '처리 중…' : '제목 영역 다시 지우기'}
            </button>
          </div>
          {titleSaved ?
            <p className="font-strip-muted" style={{ margin: '0.4rem 0 0', fontSize: '0.82rem' }}>
              제목이 저장되었고 MusicXML 주입 시 <code>work-title</code>로 사용됩니다.
            </p>
          : null}
        </div>
      ) : null}

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
              {busy ? '처리 중…' : '확인 — OMR로 계속'}
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
