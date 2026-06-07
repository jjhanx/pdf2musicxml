import { useCallback, useEffect, useMemo, useState } from 'react';
import { relabelLintReport } from './partLabelRelabel';

type MxlLintIssue = {
  code: string;
  staff?: string;
  measurePrinted?: string | null;
  measureMxl?: string;
  measurePrintedA?: string | null;
  measurePrintedB?: string | null;
  pageEstimate?: number | string;
  detail?: string;
};

type MxlLintReport = {
  issueCount?: number;
  issues?: MxlLintIssue[];
  summary?: Record<string, number>;
  measureOffsetPrinted?: number;
  pageCount?: number;
  staffOrderHint?: string[] | null;
  partLabelsByIndex?: string[] | null;
  staffsInIssues?: string[];
  byPageStaff?: { key: string; count: number }[];
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

const STAFF_FALLBACK = ['S', 'A', 'T', 'B', 'PR', 'PL'] as const;

const CODE_LABEL: Record<string, string> = {
  spuriousDirection: 'P·9 등',
  trailingPhantomRest: '마디 끝 쉼표',
  measureBoundaryOrderSuspect: '마디 경계 순서',
};

function issuePage(iss: MxlLintIssue): number {
  const n = Number(iss.pageEstimate ?? 1);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

function staffKey(iss: MxlLintIssue): string {
  const s = iss.staff;
  if (s == null || String(s).trim() === '') return '?';
  return String(s).trim();
}

function issueChipClass(code: string): string {
  if (code === 'measureBoundaryOrderSuspect') return 'omr-issue-chip omr-issue-chip--order';
  if (code === 'trailingPhantomRest') return 'omr-issue-chip omr-issue-chip--rest';
  return 'omr-issue-chip';
}

function formatIssueShort(iss: MxlLintIssue, opts?: { showPage?: boolean; showStaff?: boolean }): string {
  const label = CODE_LABEL[iss.code] ?? iss.code;
  const measure =
    iss.measurePrinted != null
      ? `m.${iss.measurePrinted}`
      : iss.measurePrintedA != null && iss.measurePrintedB != null
        ? `m.${iss.measurePrintedA}↔${iss.measurePrintedB}`
        : '';
  const detail = iss.detail ? ` ${iss.detail}` : '';
  const pageTag = opts?.showPage ? `p.${issuePage(iss)} · ` : '';
  const staffTag = opts?.showStaff ? `[${staffKey(iss)}] ` : '';
  return `${staffTag}${pageTag}${label}${measure ? ` · ${measure}` : ''}${detail}`;
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
  const [showAllIssues, setShowAllIssues] = useState(false);

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
    const [lintRes, partsRes] = await Promise.all([
      fetch(`/api/diagnostic/${jobId}/mxl-lint`, { cache: 'no-store' }),
      fetch(`/api/diagnostic/${jobId}/score-parts`, { cache: 'no-store' }),
    ]);
    const body = (await lintRes.json()) as MxlLintReport & { error?: string; lintError?: string };
    if (body.lintUnavailable) return body;
    if (!lintRes.ok) {
      throw new Error(body.lintError ?? body.error ?? `HTTP ${lintRes.status}`);
    }
    let labels: string[] | undefined;
    let parts: Array<{ id?: string; index?: number }> | undefined;
    if (partsRes.ok) {
      const pj = (await partsRes.json()) as {
        parts?: Array<{ id?: string; index?: number }>;
        savedLabelsByIndex?: string[];
        presetLabelsByIndex?: string[];
      };
      parts = pj.parts;
      labels = pj.savedLabelsByIndex?.length
        ? pj.savedLabelsByIndex
        : pj.presetLabelsByIndex?.length
          ? pj.presetLabelsByIndex
          : body.partLabelsByIndex ?? undefined;
    } else {
      labels = body.partLabelsByIndex ?? undefined;
    }
    if (labels?.length && labels.every((l) => l.trim())) {
      return relabelLintReport(body, labels, parts);
    }
    return body;
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

  const allIssues = fullReport?.issues ?? [];
  const totalIssueCount = fullReport?.issueCount ?? allIssues.length;

  const staffList = useMemo(() => {
    const fromReport = fullReport?.staffsInIssues ?? [];
    const fromIssues = [...new Set(allIssues.map((i) => i.staff).filter(Boolean))] as string[];
    const hint = fullReport?.staffOrderHint;
    const merged: string[] = [];
    const push = (s: string) => {
      if (s && !merged.includes(s)) merged.push(s);
    };
    if (hint?.length) hint.forEach(push);
    fromReport.forEach(push);
    fromIssues.forEach(push);
    if (merged.length) return merged;
    return [...STAFF_FALLBACK];
  }, [fullReport?.staffOrderHint, fullReport?.staffsInIssues, allIssues]);

  const pageIssues = useMemo(
    () => allIssues.filter((i) => issuePage(i) === page),
    [allIssues, page],
  );

  const useAllIssues =
    showAllIssues || (totalIssueCount > 0 && pageIssues.length === 0 && !staffFilter);

  const displayIssues = useMemo(() => {
    const base = useAllIssues ? allIssues : pageIssues;
    if (!staffFilter) return base;
    return base.filter((i) => i.staff === staffFilter);
  }, [useAllIssues, allIssues, pageIssues, staffFilter]);

  const issuesByStaff = useMemo(() => {
    const map = new Map<string, MxlLintIssue[]>();
    for (const iss of displayIssues) {
      const key = staffKey(iss);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(iss);
    }
    return map;
  }, [displayIssues]);

  const visibleStaffs = useMemo(() => {
    if (staffFilter) return [staffFilter];
    const keys = [...issuesByStaff.entries()]
      .filter(([, list]) => list.length > 0)
      .map(([k]) => k);
    if (keys.length > 0) return keys;
    return displayIssues.length === 0 ? staffList : [];
  }, [staffFilter, issuesByStaff, staffList, displayIssues.length]);

  const offset = fullReport?.measureOffsetPrinted ?? policy?.measureOffsetPrinted ?? 1;
  const lintFailed = Boolean(fullReport?.lintUnavailable);
  const lintFailDetail = fullReport?.lintError ?? loadErr;

  const distributionText =
    fullReport?.byPageStaff?.map((x) => `${x.key}(${x.count})`).join(', ') ?? '';

  const activePartLabels =
    fullReport?.partLabelsByIndex?.filter((l) => l && String(l).trim()) ??
    fullReport?.staffOrderHint?.filter((l) => l && String(l).trim()) ??
    [];

  return (
    <div className="modal-light" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: 0 }}>
      <div>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.2rem' }}>OMR 품질 검토 (페이지×성부)</h2>
        <p style={{ margin: 0, lineHeight: 1.55, fontSize: '0.92rem' }}>
          Audiveris 직후 MXL을 자동 점검합니다. 성부는 사용자가 지정한 라벨(
          {activePartLabels.length > 0 ? (
            <strong>{activePartLabels.join(' / ')}</strong>
          ) : (
            <strong>S/A/T/B/PR/PL</strong>
          )}
          )로 표시됩니다(PDF <strong>페이지 p.</strong>와 다름). Lint 칩은 PDF 아래{' '}
          <strong>파란 박스</strong>에 있습니다. 인쇄 마디 ≈ MXL <code>measure@number</code> + {offset}.
        </p>
      </div>

      {policy?.audiverisOcrLangEffective != null && (
        <p style={{ margin: 0, fontSize: '0.85rem', color: '#444' }}>
          서버 OCR: <code>{policy.audiverisOcrLangEffective}</code>
        </p>
      )}

      {(lintFailed || loadErr) && (
        <div className="omr-lint-warn" role="alert">
          <strong>MXL 자동 점검을 불러오지 못했습니다.</strong>
          <br />
          아래 PDF만 보고 검토한 뒤 이어하기를 눌러 계속할 수 있습니다.
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
          전체
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

      {!lintFailed && displayIssues.length > 0 && (
        <div className="omr-lint-results-panel">
          <div className="omr-lint-results-title">
            Lint 결과 {useAllIssues ? '(악보 전체)' : `(이 PDF p.${page})`} — {displayIssues.length}건
          </div>
          <p className="omr-lint-results-hint">
            아래 색 칩이 자동 점검 힌트입니다. PDF 악보 그림과 겹쳐 표시되지 않습니다. 마디 번호로 PDF와
            대조하세요.
          </p>
          <div className="omr-lint-results-legend">
            <span>
              <span className="omr-issue-chip">예</span> P·9 등
            </span>
            <span>
              <span className="omr-issue-chip omr-issue-chip--rest">예</span> 마디 끝 쉼표
            </span>
            <span>
              <span className="omr-issue-chip omr-issue-chip--order">예</span> 마디 경계 순서
            </span>
          </div>
          <div className="omr-lint-results-chips">
            {displayIssues.map((iss, idx) => (
              <span
                key={`chip-${idx}`}
                className={issueChipClass(iss.code)}
                title={CODE_LABEL[iss.code] ?? iss.code}
              >
                {formatIssueShort(iss, { showPage: useAllIssues, showStaff: true })}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        {!lintFailed && totalIssueCount > 0 && pageIssues.length === 0 && !showAllIssues && (
          <div className="omr-lint-warn" style={{ marginBottom: '0.75rem' }}>
            <strong>악보 전체 {totalIssueCount}건</strong>이 있으나, 마디 기준 <strong>추정 p.{page}</strong>에는
            0건입니다. (페이지 추정은 마디÷쪽수 근사치라 PDF와 어긋날 수 있습니다.)
            {distributionText ? (
              <>
                <br />
                <span style={{ fontSize: '0.85rem' }}>분포: {distributionText}</span>
              </>
            ) : null}
            <br />
            <button
              type="button"
              style={{ marginTop: '0.5rem', padding: '0.35rem 0.75rem', fontSize: '0.85rem' }}
              onClick={() => setShowAllIssues(true)}
            >
              악보 전체 lint 보기 ({totalIssueCount}건)
            </button>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '0.5rem',
            marginBottom: 8,
          }}
        >
          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#222' }}>
            {useAllIssues ? '악보 전체' : `이 페이지(p.${page})`} · 성부별 lint ({displayIssues.length}건
            {fullReport?.summary && !lintFailed ? (
              <span style={{ fontWeight: 400, color: '#555', marginLeft: 6 }}>
                / 전체 P류 {fullReport.summary.spuriousDirection ?? 0}, 쉼표{' '}
                {fullReport.summary.trailingPhantomRest ?? 0}, 경계{' '}
                {fullReport.summary.measureBoundaryOrderSuspect ?? 0}
              </span>
            ) : null}
            )
          </span>
          {showAllIssues && (
            <button
              type="button"
              className="btn-muted"
              style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
              onClick={() => setShowAllIssues(false)}
            >
              이 페이지만 보기
            </button>
          )}
        </div>

        {loading && !fullReport && <p style={{ color: '#555' }}>lint 불러오는 중…</p>}

        {!loading && totalIssueCount === 0 && !lintFailed && (
          <p style={{ color: '#2e7d32', fontWeight: 600, fontSize: '0.9rem' }}>
            자동 점검에서 의심 항목이 없습니다. PDF만 훑고 이어하기를 눌러도 됩니다.
          </p>
        )}

        {displayIssues.length > 0 && visibleStaffs.length > 0 && (
          <>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#444', marginBottom: 6 }}>
              성부별로 보기 (위 파란 박스와 동일 내용)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
              {visibleStaffs.map((staffId) => {
                const staffIssues = issuesByStaff.get(staffId) ?? [];
                return (
                  <div key={staffId} className="omr-staff-row">
                    <div className="omr-staff-label">{staffId}</div>
                    <div className="omr-staff-issues">
                      {staffIssues.map((iss, idx) => (
                        <span
                          key={`${iss.code}-${idx}`}
                          className={issueChipClass(iss.code)}
                          title={CODE_LABEL[iss.code] ?? iss.code}
                        >
                          {formatIssueShort(iss, { showPage: useAllIssues })}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {displayIssues.length === 0 && !loading && !lintFailed && totalIssueCount > 0 && (
          <p className="omr-staff-empty" style={{ margin: 0 }}>
            {useAllIssues
              ? '표시할 lint 항목이 없습니다.'
              : `이 PDF p.${page}에는 lint 항목이 없습니다. 다른 페이지를 넘기거나 「악보 전체 lint 보기」를 사용하세요.`}
          </p>
        )}
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
      </div>
    </div>
  );
}
