import { useCallback, useEffect, useMemo, useState } from 'react';

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
  lintUnavailable?: boolean;
  lintError?: string;
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

const STAFF_ORDER = ['S', 'A', 'T', 'B', 'PR', 'PL'] as const;

const CODE_LABEL: Record<string, string> = {
  spuriousDirection: 'P·9 등',
  trailingPhantomRest: '마디 끝 쉼표',
  measureBoundaryOrderSuspect: '마디 경계 순서',
};

function issueChipClass(code: string): string {
  if (code === 'measureBoundaryOrderSuspect') return 'omr-issue-chip omr-issue-chip--order';
  if (code === 'trailingPhantomRest') return 'omr-issue-chip omr-issue-chip--rest';
  return 'omr-issue-chip';
}

function formatIssueShort(iss: MxlLintIssue): string {
  const label = CODE_LABEL[iss.code] ?? iss.code;
  const measure =
    iss.measurePrinted != null
      ? `m.${iss.measurePrinted}`
      : iss.measurePrintedA != null && iss.measurePrintedB != null
        ? `m.${iss.measurePrintedA}↔${iss.measurePrintedB}`
        : '';
  const detail = iss.detail ? ` ${iss.detail}` : '';
  return `${label}${measure ? ` · ${measure}` : ''}${detail}`;
}

type Props = {
  jobId: string;
  onContinue: () => void | Promise<void>;
  continuing?: boolean;
};

export function OmrStaffReviewPanel({ jobId, onContinue, continuing }: Props) {
  const [summary, setSummary] = useState<InspectSummary | null>(null);
  const [policy, setPolicy] = useState<OmrPolicy | null>(null);
  const [fullReport, setFullReport] = useState<MxlLintReport | null>(null);
  const [page, setPage] = useState(1);
  const [staffFilter, setStaffFilter] = useState('');
  const [loadErr, setLoadErr] = useState('');
  const [loading, setLoading] = useState(true);

  const pageCount = Math.max(
    1,
    summary?.pageCountForUi ?? fullReport?.pageCount ?? 1,
  );
  const pngSource =
    summary?.cleanScorePdf?.exists || summary?.audiverisInputPdf === 'clean_score'
      ? 'clean_score'
      : 'original';
  const pngDpi = 156;

  const fetchFullLint = useCallback(async () => {
    const r = await fetch(`/api/diagnostic/${jobId}/mxl-lint`, { cache: 'no-store' });
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try {
        const j = (await r.json()) as { error?: string; lintError?: string };
        msg = j.lintError ?? j.error ?? msg;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    return (await r.json()) as MxlLintReport;
  }, [jobId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadErr('');
    void (async () => {
      try {
        const [sumRes, polRes, lint] = await Promise.all([
          fetch(`/api/diagnostic/${jobId}/summary`, { cache: 'no-store' }),
          fetch(`/api/diagnostic/${jobId}/omr-policy`, { cache: 'no-store' }),
          fetchFullLint(),
        ]);
        if (cancelled) return;
        if (sumRes.ok) setSummary((await sumRes.json()) as InspectSummary);
        if (polRes.ok) setPolicy((await polRes.json()) as OmrPolicy);
        setFullReport(lint);
        if (lint.lintUnavailable && lint.lintError) {
          setLoadErr('');
        }
      } catch (e) {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, fetchFullLint]);

  const staffList = useMemo(() => {
    const hint = fullReport?.staffOrderHint;
    if (Array.isArray(hint) && hint.length > 0) return hint;
    return [...STAFF_ORDER];
  }, [fullReport?.staffOrderHint]);

  const pageIssues = useMemo(() => {
    const all = fullReport?.issues ?? [];
    return all.filter((i) => (i.pageEstimate ?? 1) === page);
  }, [fullReport?.issues, page]);

  const issuesByStaff = useMemo(() => {
    const map = new Map<string, MxlLintIssue[]>();
    for (const s of staffList) map.set(s, []);
    for (const iss of pageIssues) {
      const key = iss.staff ?? '?';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(iss);
    }
    return map;
  }, [pageIssues, staffList]);

  const visibleStaffs = staffFilter
    ? staffList.filter((s) => s === staffFilter)
    : staffList;

  const offset = fullReport?.measureOffsetPrinted ?? policy?.measureOffsetPrinted ?? 1;
  const lintFailed = Boolean(fullReport?.lintUnavailable);
  const lintFailDetail = fullReport?.lintError ?? loadErr;

  return (
    <div className="modal-light" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: 0 }}>
      <div>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.2rem' }}>OMR 품질 검토 (페이지×성부)</h2>
        <p style={{ margin: 0, lineHeight: 1.55, fontSize: '0.92rem' }}>
          Audiveris 직후 MXL을 자동 점검합니다. 아래는 <strong>휴리스틱</strong>이며 SYMBOLS 탭의 모든
          오류를 잡지는 않습니다. 인쇄 마디 ≈ MXL <code>measure@number</code> + {offset}. PDF와 성부별
          한 줄 목록을 대조한 뒤 「이어하기」로 넘어가세요.
        </p>
      </div>

      {policy?.audiverisOcrLangEffective != null && (
        <p style={{ margin: 0, fontSize: '0.85rem', color: '#444' }}>
          서버 OCR: <code>{policy.audiverisOcrLangEffective}</code>
          {policy.audiverisOcrLangEffective !== 'eng' && (
            <> — clean_score에 한글이 없을 때는 <code>eng</code> 권장(세잇단 3→P 완화).</>
          )}
        </p>
      )}

      {(lintFailed || loadErr) && (
        <div className="omr-lint-warn" role="alert">
          <strong>MXL 자동 점검을 불러오지 못했습니다.</strong>
          <br />
          {lintFailed ? (
            <>
              서버에서 <code>scripts/mxl_quality_lint.py</code> 실행이 실패했거나 결과 JSON이 없습니다.
              아래 PDF만 보고 검토한 뒤 이어하기를 눌러 계속할 수 있습니다.
            </>
          ) : (
            <>요약·정책 API 조회 중 오류가 났습니다.</>
          )}
          {lintFailDetail ? (
            <pre
              style={{
                margin: '0.5rem 0 0',
                padding: '0.5rem',
                background: '#fff',
                borderRadius: 4,
                fontSize: '0.78rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: '#5d4037',
                maxHeight: '8rem',
                overflow: 'auto',
              }}
            >
              {lintFailDetail}
            </pre>
          ) : null}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>페이지</span>
        <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          ◀
        </button>
        <span style={{ fontWeight: 600 }}>
          {page} / {pageCount}
        </span>
        <button
          type="button"
          disabled={page >= pageCount}
          onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
        >
          ▶
        </button>
        <span style={{ marginLeft: '0.75rem', fontSize: '0.9rem', fontWeight: 600 }}>성부 필터</span>
        <button
          type="button"
          className={staffFilter === '' ? '' : 'btn-muted'}
          onClick={() => setStaffFilter('')}
        >
          전체(6줄)
        </button>
        {staffList.map((s) => (
          <button
            key={s}
            type="button"
            className={staffFilter === s ? '' : 'btn-muted'}
            onClick={() => setStaffFilter(s)}
          >
            {s}
          </button>
        ))}
      </div>

      <div>
        <div style={{ fontSize: '0.88rem', marginBottom: 6, fontWeight: 600, color: '#333' }}>
          PDF 미리보기 ({pngSource === 'clean_score' ? 'clean_score' : '원본'}) · p.{page} · {pngDpi} DPI
        </div>
        <div className="omr-pdf-frame">
          <img
            alt={`페이지 ${page}`}
            src={`/api/diagnostic/${jobId}/page/${page}/png?source=${pngSource}&dpi=${pngDpi}`}
          />
        </div>
        <a href={`/api/raw-mxl/${jobId}`} download style={{ display: 'inline-block', marginTop: 8, fontSize: '0.88rem' }}>
          Audiveris 원본 MXL 다운로드
        </a>
      </div>

      <div>
        <div style={{ fontSize: '0.9rem', marginBottom: 8, fontWeight: 600, color: '#222' }}>
          이 페이지 · 성부별 lint ({pageIssues.length}건
          {fullReport?.summary && !lintFailed ? (
            <span style={{ fontWeight: 400, color: '#555', marginLeft: 6 }}>
              — 전체 P류 {fullReport.summary.spuriousDirection ?? 0}, 쉼표{' '}
              {fullReport.summary.trailingPhantomRest ?? 0}, 경계{' '}
              {fullReport.summary.measureBoundaryOrderSuspect ?? 0})
            </span>
          ) : null}
          )
        </div>
        {loading && !fullReport && <p style={{ color: '#555' }}>lint 불러오는 중…</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
          {visibleStaffs.map((staffId) => {
            const staffIssues = issuesByStaff.get(staffId) ?? [];
            return (
              <div key={staffId} className="omr-staff-row">
                <div className="omr-staff-label">{staffId}</div>
                <div className="omr-staff-issues">
                  {staffIssues.length === 0 ? (
                    <span className="omr-staff-empty">이 페이지에서 lint 항목 없음</span>
                  ) : (
                    staffIssues.map((iss, idx) => (
                      <span
                        key={`${iss.code}-${idx}`}
                        className={issueChipClass(iss.code)}
                        title={CODE_LABEL[iss.code] ?? iss.code}
                      >
                        {formatIssueShort(iss)}
                      </span>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {policy?.pCauses && policy.pCauses.length > 0 && (
        <details style={{ fontSize: '0.85rem', color: '#444' }}>
          <summary style={{ fontWeight: 600, cursor: 'pointer' }}>P·세잇단·쉼표 유발 경로 (참고)</summary>
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
        <span style={{ fontSize: '0.82rem', color: '#555' }}>
          MuseScore 등에서 고친 MXL은 다음 「Audiveris 결과 보정」 단계에서 교체할 수 있습니다.
        </span>
      </div>
    </div>
  );
}
