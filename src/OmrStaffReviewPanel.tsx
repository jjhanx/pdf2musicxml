import { useCallback, useEffect, useState } from 'react';

type MxlLintIssue = {
  code: string;
  staff?: string;
  measurePrinted?: string | null;
  measureMxl?: string;
  measurePrintedA?: string | null;
  measurePrintedB?: string | null;
  pageEstimate?: number;
  detail?: string;
};

type MxlLintReport = {
  issueCount?: number;
  issues?: MxlLintIssue[];
  summary?: Record<string, number>;
  measureOffsetPrinted?: number;
  pageCount?: number;
  staffOrderHint?: string[] | null;
  byPageStaff?: { key: string; count: number }[];
};

type OmrPolicy = {
  audiverisOcrLangEffective?: string | null;
  measureOffsetPrinted?: number;
  pCauses?: string[];
  lintSummary?: Record<string, number>;
};

type InspectSummary = {
  pageCountForUi: number;
  cleanScorePdf?: { exists: boolean };
  audiverisInputPdf?: string | null;
};

const STAFF_TABS = ['', 'S', 'A', 'T', 'B', 'PR', 'PL'] as const;

const CODE_LABEL: Record<string, string> = {
  spuriousDirection: '잘못된 direction 글자 (P·9 등)',
  trailingPhantomRest: '마디 끝 의심 쉼표 (8분·16분)',
  measureBoundaryOrderSuspect: '마디 경계 음 순서 의심',
};

type Props = {
  jobId: string;
  onContinue: () => void | Promise<void>;
  continuing?: boolean;
};

export function OmrStaffReviewPanel({ jobId, onContinue, continuing }: Props) {
  const [summary, setSummary] = useState<InspectSummary | null>(null);
  const [policy, setPolicy] = useState<OmrPolicy | null>(null);
  const [report, setReport] = useState<MxlLintReport | null>(null);
  const [page, setPage] = useState(1);
  const [staff, setStaff] = useState('');
  const [loadErr, setLoadErr] = useState('');
  const [loading, setLoading] = useState(true);

  const pageCount = Math.max(1, summary?.pageCountForUi ?? report?.pageCount ?? 1);
  const pngSource =
    summary?.cleanScorePdf?.exists || summary?.audiverisInputPdf === 'clean_score'
      ? 'clean_score'
      : 'original';

  const fetchLint = useCallback(async () => {
    const q = new URLSearchParams();
    if (page >= 1) q.set('page', String(page));
    if (staff) q.set('staff', staff);
    const r = await fetch(`/api/diagnostic/${jobId}/mxl-lint?${q}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`MXL lint HTTP ${r.status}`);
    return (await r.json()) as MxlLintReport;
  }, [jobId, page, staff]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadErr('');
    void (async () => {
      try {
        const [sumRes, polRes, lint] = await Promise.all([
          fetch(`/api/diagnostic/${jobId}/summary`, { cache: 'no-store' }),
          fetch(`/api/diagnostic/${jobId}/omr-policy`, { cache: 'no-store' }),
          fetchLint(),
        ]);
        if (cancelled) return;
        if (sumRes.ok) setSummary((await sumRes.json()) as InspectSummary);
        if (polRes.ok) setPolicy((await polRes.json()) as OmrPolicy);
        setReport(lint);
      } catch (e) {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, fetchLint]);

  const issues = report?.issues ?? [];
  const offset = report?.measureOffsetPrinted ?? policy?.measureOffsetPrinted ?? 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: 0 }}>
      <div>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.15rem' }}>OMR 품질 검토 (페이지×성부)</h2>
        <p style={{ margin: 0, lineHeight: 1.55, color: '#555', fontSize: '0.92rem' }}>
          Audiveris 직후 MXL을 자동 점검했습니다. 아래는 <strong>휴리스틱</strong>이며 SYMBOLS 탭의 모든
          오류를 잡지는 않습니다. 인쇄 마디 ≈ MXL <code>measure@number</code> + {offset}. 문제가 없어도
          「이어하기」로 가사 주입 단계로 넘어가세요.
        </p>
      </div>

      {policy?.audiverisOcrLangEffective != null && (
        <p style={{ margin: 0, fontSize: '0.85rem', color: '#666' }}>
          서버 OCR: <code>{policy.audiverisOcrLangEffective}</code>
          {policy.audiverisOcrLangEffective !== 'eng' && (
            <>
              {' '}
              — clean_score에 한글이 없을 때는 <code>eng</code> 권장(세잇단 3→P 완화).
            </>
          )}
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <span style={{ fontSize: '0.9rem' }}>페이지</span>
        <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          ◀
        </button>
        <span>
          {page} / {pageCount}
        </span>
        <button
          type="button"
          disabled={page >= pageCount}
          onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
        >
          ▶
        </button>
        <span style={{ marginLeft: '0.75rem', fontSize: '0.9rem' }}>성부</span>
        {STAFF_TABS.map((s) => (
          <button
            key={s || 'all'}
            type="button"
            className={staff === s ? '' : 'btn-muted'}
            onClick={() => setStaff(s)}
          >
            {s || '전체'}
          </button>
        ))}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(200px, 1fr) minmax(260px, 1.2fr)',
          gap: '1rem',
          alignItems: 'start',
        }}
      >
        <div>
          <div style={{ fontSize: '0.85rem', marginBottom: 6, color: '#666' }}>
            PDF ({pngSource === 'clean_score' ? 'clean_score' : '원본'}) p.{page}
          </div>
          <img
            alt={`페이지 ${page}`}
            src={`/api/diagnostic/${jobId}/page/${page}/png?source=${pngSource}&dpi=120`}
            style={{
              width: '100%',
              maxHeight: '42vh',
              objectFit: 'contain',
              background: '#f0f0f0',
              borderRadius: 6,
              border: '1px solid #ddd',
            }}
          />
          <a
            href={`/api/raw-mxl/${jobId}`}
            download
            style={{ display: 'inline-block', marginTop: 8, fontSize: '0.88rem' }}
          >
            Audiveris 원본 MXL 다운로드
          </a>
        </div>

        <div style={{ minHeight: 120 }}>
          {loading && <p style={{ color: '#666' }}>lint 불러오는 중…</p>}
          {loadErr && (
            <p style={{ color: '#c62828' }} role="alert">
              {loadErr}
            </p>
          )}
          {!loading && !loadErr && (
            <>
              <div style={{ fontSize: '0.9rem', marginBottom: 8 }}>
                이 필터: <strong>{issues.length}</strong>건
                {report?.summary && (
                  <span style={{ color: '#666', marginLeft: 8 }}>
                    (전체 P류 {report.summary.spuriousDirection ?? 0}, 쉼표{' '}
                    {report.summary.trailingPhantomRest ?? 0}, 경계{' '}
                    {report.summary.measureBoundaryOrderSuspect ?? 0})
                  </span>
                )}
              </div>
              <ul
                style={{
                  margin: 0,
                  padding: '0 0 0 1.1rem',
                  maxHeight: '38vh',
                  overflow: 'auto',
                  lineHeight: 1.45,
                  fontSize: '0.88rem',
                }}
              >
                {issues.length === 0 && (
                  <li style={{ listStyle: 'none', marginLeft: '-1.1rem', color: '#666' }}>
                    이 페이지·성부 조합에서 lint 항목이 없습니다.
                  </li>
                )}
                {issues.map((iss, idx) => (
                  <li key={`${iss.code}-${idx}`} style={{ marginBottom: 6 }}>
                    <strong>{CODE_LABEL[iss.code] ?? iss.code}</strong>
                    {iss.staff ? ` · ${iss.staff}` : ''}
                    {iss.measurePrinted != null && ` · 마디 ${iss.measurePrinted}`}
                    {iss.measurePrintedA != null &&
                      iss.measurePrintedB != null &&
                      ` · 마디 ${iss.measurePrintedA}↔${iss.measurePrintedB}`}
                    {iss.detail ? ` — ${iss.detail}` : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      {policy?.pCauses && policy.pCauses.length > 0 && (
        <details style={{ fontSize: '0.85rem', color: '#555' }}>
          <summary>P·세잇단·쉼표 유발 경로 (참고)</summary>
          <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem' }}>
            {policy.pCauses.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </details>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => void onContinue()}
          disabled={continuing}
          style={{
            padding: '0.65rem 1.25rem',
            fontSize: '1rem',
            background: '#2e7d32',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: continuing ? 'wait' : 'pointer',
            fontWeight: 600,
          }}
        >
          {continuing ? '이어가는 중…' : '이어하기 (가사·메타 주입)'}
        </button>
        <span style={{ fontSize: '0.82rem', color: '#666' }}>
          MuseScore 등에서 고친 MXL은 다음 「Audiveris 결과 보정」 단계에서 교체할 수 있습니다.
        </span>
      </div>
    </div>
  );
}
