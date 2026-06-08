import { useCallback, useEffect, useMemo, useState } from 'react';
import { relabelLintReport } from './partLabelRelabel';
import {
  isActionableLintCode,
  lintIssueToFix,
  LINT_CODE_LABEL,
  mergeFix,
  type OmrHitlFix,
} from './omrHitlFixes';

type MxlLintIssue = {
  code: string;
  staff?: string;
  partId?: string;
  measurePrinted?: string | null;
  measureMxl?: string;
  measurePrintedA?: string | null;
  measurePrintedB?: string | null;
  pageEstimate?: number | string;
  detail?: string;
  noteIndex?: number;
  suggestedStaff?: number;
  suggestedLineDelta?: number;
};

type ScorePartRow = {
  id: string;
  index: number;
  suggestedLabel: string;
};

type MeasureNoteRow = {
  index: number;
  kind: string;
  type?: string | null;
  staff?: number | null;
  displayStep?: string | null;
  displayOctave?: string | null;
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
  restMissingStaff: '쉼표 스태프 누락',
  restDisplayHigh: '쉼표 줄 높음',
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
  if (
    code === 'trailingPhantomRest' ||
    code === 'restMissingStaff' ||
    code === 'restDisplayHigh'
  ) {
    return 'omr-issue-chip omr-issue-chip--rest';
  }
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
  const [pendingFixes, setPendingFixes] = useState<OmrHitlFix[]>([]);
  const [scoreParts, setScoreParts] = useState<ScorePartRow[]>([]);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyMsg, setApplyMsg] = useState('');
  const [measureStaff, setMeasureStaff] = useState('');
  const [measurePrinted, setMeasurePrinted] = useState('');
  const [measureNotes, setMeasureNotes] = useState<MeasureNoteRow[]>([]);
  const [measureLoadErr, setMeasureLoadErr] = useState('');
  const [measureBusy, setMeasureBusy] = useState(false);

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

  const persistFixes = useCallback(
    async (fixes: OmrHitlFix[]) => {
      const r = await fetch(`/api/omr-hitl/${jobId}/fixes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fixes }),
      });
      if (!r.ok) {
        const j = (await r.json()) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
    },
    [jobId],
  );

  const reloadLint = useCallback(async () => {
    const lint = await fetchFullLint();
    setFullReport(lint);
    return lint;
  }, [fetchFullLint]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadErr('');
    void (async () => {
      try {
        const [sumRes, polRes, lint, fixesRes, partsRes] = await Promise.all([
          fetch(`/api/diagnostic/${jobId}/summary`, { cache: 'no-store' }),
          fetch(`/api/diagnostic/${jobId}/omr-policy`, { cache: 'no-store' }),
          fetchFullLint(),
          fetch(`/api/omr-hitl/${jobId}/fixes`, { cache: 'no-store' }),
          fetch(`/api/diagnostic/${jobId}/score-parts`, { cache: 'no-store' }),
        ]);
        if (cancelled) return;
        if (sumRes.ok) setSummary((await sumRes.json()) as InspectSummary);
        if (polRes.ok) setPolicy((await polRes.json()) as OmrPolicy);
        setFullReport(lint);
        if (fixesRes.ok) {
          const fj = (await fixesRes.json()) as { fixes?: OmrHitlFix[] };
          if (Array.isArray(fj.fixes)) setPendingFixes(fj.fixes);
        }
        if (partsRes.ok) {
          const pj = (await partsRes.json()) as { parts?: ScorePartRow[] };
          const list = Array.isArray(pj.parts) ? pj.parts : [];
          setScoreParts(
            list.map((p) => ({
              id: p.id,
              index: p.index,
              suggestedLabel: p.suggestedLabel,
            })),
          );
        }
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

  const partIdForStaff = useCallback(
    (staffLabel: string): string | null => {
      const labels =
        fullReport?.partLabelsByIndex?.filter((l) => l && String(l).trim()) ??
        fullReport?.staffOrderHint ??
        [];
      const idx = labels.indexOf(staffLabel);
      if (idx >= 0 && scoreParts[idx]) return scoreParts[idx].id;
      const hit = scoreParts.find((p) => p.suggestedLabel === staffLabel);
      return hit?.id ?? null;
    },
    [fullReport?.partLabelsByIndex, fullReport?.staffOrderHint, scoreParts],
  );

  const addFix = useCallback(
    (fix: OmrHitlFix) => {
      setPendingFixes((prev) => {
        const next = mergeFix(prev, fix);
        void persistFixes(next).catch((e) => {
          console.error(e);
          alert(e instanceof Error ? e.message : String(e));
        });
        return next;
      });
    },
    [persistFixes],
  );

  const removeFix = useCallback(
    (id: string) => {
      setPendingFixes((prev) => {
        const next = prev.filter((f) => f.id !== id);
        void persistFixes(next).catch(console.error);
        return next;
      });
    },
    [persistFixes],
  );

  const applyFixesToMxl = useCallback(async () => {
    setApplyBusy(true);
    setApplyMsg('');
    try {
      await persistFixes(pendingFixes);
      const r = await fetch(`/api/omr-hitl/${jobId}/apply`, { method: 'POST' });
      if (!r.ok) {
        const j = (await r.json()) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      const j = (await r.json()) as {
        stats?: { applied?: number; skipped?: number };
        lint?: MxlLintReport;
      };
      if (j.lint) setFullReport(j.lint);
      else await reloadLint();
      const applied = j.stats?.applied ?? 0;
      const skipped = j.stats?.skipped ?? 0;
      setPendingFixes([]);
      await persistFixes([]);
      setApplyMsg(`MXL에 보정 반영됨 (적용 ${applied}, 건너뜀 ${skipped}). 아래 lint가 갱신되었습니다.`);
    } catch (e) {
      setApplyMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyBusy(false);
    }
  }, [jobId, pendingFixes, persistFixes, reloadLint]);

  const loadMeasureNotes = useCallback(async () => {
    const staff = measureStaff.trim();
    const printed = measurePrinted.trim();
    if (!staff || !printed) {
      setMeasureLoadErr('성부와 인쇄 마디 번호를 입력하세요.');
      return;
    }
    const offset = fullReport?.measureOffsetPrinted ?? policy?.measureOffsetPrinted ?? 1;
    const measureMxl = String(Math.max(1, parseInt(printed, 10) - offset));
    const partId = partIdForStaff(staff);
    if (!partId) {
      setMeasureLoadErr(`성부 ${staff}에 해당하는 partId를 찾지 못했습니다.`);
      return;
    }
    setMeasureBusy(true);
    setMeasureLoadErr('');
    try {
      const r = await fetch(
        `/api/omr-hitl/${jobId}/measure?partId=${encodeURIComponent(partId)}&measureMxl=${encodeURIComponent(measureMxl)}`,
        { cache: 'no-store' },
      );
      const j = (await r.json()) as { notes?: MeasureNoteRow[]; error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setMeasureNotes(Array.isArray(j.notes) ? j.notes : []);
    } catch (e) {
      setMeasureLoadErr(e instanceof Error ? e.message : String(e));
      setMeasureNotes([]);
    } finally {
      setMeasureBusy(false);
    }
  }, [
    measureStaff,
    measurePrinted,
    fullReport?.measureOffsetPrinted,
    policy?.measureOffsetPrinted,
    partIdForStaff,
    jobId,
  ]);

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
          Audiveris 직후 MXL을 자동 점검합니다. <strong>앱 안에서</strong> lint 항목·쉼표 위치를
          보정한 뒤 「보정 MXL에 적용」→「이어하기」를 누르면 최종 MXL에 반영됩니다(MuseScore
          불필요). 성부 라벨(
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
            <span>
              <span className="omr-issue-chip omr-issue-chip--rest">예</span> 쉼표 줄·스태프
            </span>
          </div>
          <div className="omr-lint-results-chips">
            {displayIssues.map((iss, idx) => (
              <div key={`chip-${idx}`} className="omr-hitl-issue-row">
                <span
                  className={issueChipClass(iss.code)}
                  title={CODE_LABEL[iss.code] ?? iss.code}
                >
                  {formatIssueShort(iss, { showPage: useAllIssues, showStaff: true })}
                </span>
                {isActionableLintCode(iss.code) && (
                  <button
                    type="button"
                    className="omr-hitl-fix-btn"
                    onClick={() => {
                      const fix = lintIssueToFix(iss);
                      if (fix) addFix(fix);
                    }}
                  >
                    + {LINT_CODE_LABEL[iss.code] ?? '보정 추가'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="omr-hitl-panel">
        <div className="omr-hitl-panel-title">앱 내 MXL 보정 (대기 {pendingFixes.length}건)</div>
        <p className="omr-hitl-panel-hint">
          보정을 추가한 뒤 「보정 MXL에 적용」으로 Audiveris MXL을 갱신하세요. 이어하기 시에도
          자동 적용됩니다.
        </p>
        {pendingFixes.length > 0 ? (
          <ul className="omr-hitl-fix-list">
            {pendingFixes.map((f) => (
              <li key={f.id}>
                <code>{f.kind}</code> · {f.partId} · m.{f.measureMxl}
                {f.noteIndex != null ? ` · note#${f.noteIndex}` : ''}
                <button type="button" className="btn-muted omr-hitl-remove" onClick={() => removeFix(f.id)}>
                  삭제
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="omr-hitl-empty">대기 중인 보정 없음 — lint 칩의 「+ 보정」 또는 아래 수동 쉼표 조정을 사용하세요.</p>
        )}
        <div className="omr-hitl-actions">
          <button type="button" disabled={applyBusy || pendingFixes.length === 0} onClick={() => void applyFixesToMxl()}>
            {applyBusy ? '적용 중…' : '보정 MXL에 적용'}
          </button>
        </div>
        {applyMsg ? <p className="omr-hitl-apply-msg">{applyMsg}</p> : null}

        <details className="omr-hitl-measure-details">
          <summary>수동 — 마디별 쉼표 줄 조정</summary>
          <p style={{ fontSize: '0.85rem', margin: '0.5rem 0', color: '#444' }}>
            인쇄 마디 번호(악보에 인쇄된 번호)와 성부를 넣고 불러온 뒤, 쉼표에 「한 줄 아래」를
            누르세요.
          </p>
          <div className="omr-hitl-measure-form">
            <label>
              성부
              <select value={measureStaff} onChange={(e) => setMeasureStaff(e.target.value)}>
                <option value="">선택</option>
                {staffList.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              인쇄 마디
              <input
                type="number"
                min={1}
                value={measurePrinted}
                onChange={(e) => setMeasurePrinted(e.target.value)}
                style={{ width: 72 }}
              />
            </label>
            <button type="button" disabled={measureBusy} onClick={() => void loadMeasureNotes()}>
              {measureBusy ? '불러오는 중…' : '마디 불러오기'}
            </button>
          </div>
          {measureLoadErr ? <p className="omr-hitl-measure-err">{measureLoadErr}</p> : null}
          {measureNotes.length > 0 && (
            <ul className="omr-hitl-note-list">
              {measureNotes
                .filter((n) => n.kind === 'rest')
                .map((n) => (
                  <li key={n.index}>
                    쉼표 #{n.index} {n.type ?? ''}{' '}
                    {n.displayStep ? `(${n.displayStep}${n.displayOctave ?? ''})` : ''}
                    {n.staff != null ? ` staff=${n.staff}` : ''}
                    <button
                      type="button"
                      className="omr-hitl-fix-btn"
                      onClick={() => {
                        const partId = partIdForStaff(measureStaff);
                        if (!partId) return;
                        const offset = fullReport?.measureOffsetPrinted ?? 1;
                        const measureMxl = String(
                          Math.max(1, parseInt(measurePrinted, 10) - offset),
                        );
                        addFix({
                          id: crypto.randomUUID(),
                          kind: 'nudgeRestDisplay',
                          partId,
                          measureMxl,
                          noteIndex: n.index,
                          lineDelta: 1,
                          source: 'manual',
                        });
                      }}
                    >
                      한 줄 아래
                    </button>
                    <button
                      type="button"
                      className="omr-hitl-fix-btn"
                      onClick={() => {
                        const partId = partIdForStaff(measureStaff);
                        if (!partId) return;
                        const offset = fullReport?.measureOffsetPrinted ?? 1;
                        const measureMxl = String(
                          Math.max(1, parseInt(measurePrinted, 10) - offset),
                        );
                        addFix({
                          id: crypto.randomUUID(),
                          kind: 'nudgeRestDisplay',
                          partId,
                          measureMxl,
                          noteIndex: n.index,
                          lineDelta: -1,
                          source: 'manual',
                        });
                      }}
                    >
                      한 줄 위
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </details>
      </div>

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
