import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  filterMusicXmlToPart,
  InspectPanelErrorBoundary,
  OsmdBlock,
  parseScoreParts,
} from './AudiverisInspectPanel';
import { OmrMeasureEditor } from './OmrMeasureEditor';
import { formatFixSummary, mergeFix, type OmrHitlFix } from './omrHitlFixes';
import type { OsmdMeasureClickInfo } from './osmdMeasureClick';

type ScorePartRow = {
  id: string;
  index: number;
  suggestedLabel: string;
};

type OmrPolicy = {
  audiverisOcrLangEffective?: string | null;
  measureOffsetPrinted?: number;
  pCauses?: string[];
};

type InspectSummary = {
  pageCountForUi: number;
  cleanScorePdf?: { exists: boolean };
  audiverisInputPdf?: string | null;
};

const STAFF_FALLBACK = ['S', 'A', 'T', 'B', 'PR', 'PL'] as const;

type Props = {
  jobId: string;
  onContinue: () => void | Promise<void>;
  continuing?: boolean;
};

export function OmrStaffReviewPanel({ jobId, onContinue, continuing }: Props) {
  const [summary, setSummary] = useState<InspectSummary | null>(null);
  const [policy, setPolicy] = useState<OmrPolicy | null>(null);
  const [page, setPage] = useState(1);
  const [staffFilter, setStaffFilter] = useState('');
  const [loadErr, setLoadErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [pendingFixes, setPendingFixes] = useState<OmrHitlFix[]>([]);
  const [scoreParts, setScoreParts] = useState<ScorePartRow[]>([]);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyMsg, setApplyMsg] = useState('');
  const [rawXml, setRawXml] = useState<string | null>(null);
  const [xmlLoading, setXmlLoading] = useState(false);
  const [xmlLoadErr, setXmlLoadErr] = useState('');
  const [osmdPartId, setOsmdPartId] = useState('');
  const [scoreZoom, setScoreZoom] = useState(0.55);
  const [selectedMeasure, setSelectedMeasure] = useState<OsmdMeasureClickInfo | null>(null);
  const [editPartId, setEditPartId] = useState('');
  const [editorKey, setEditorKey] = useState(0);

  const pageCount = Math.max(1, summary?.pageCountForUi ?? 1);
  const pngSource =
    summary?.cleanScorePdf?.exists || summary?.audiverisInputPdf === 'clean_score'
      ? 'clean_score'
      : 'original';
  const pngDpi = 156;
  const measureOffset = policy?.measureOffsetPrinted ?? 1;

  const staffList = useMemo(() => {
    const fromParts = scoreParts.map((p) => p.suggestedLabel).filter(Boolean);
    if (fromParts.length) return fromParts;
    return [...STAFF_FALLBACK];
  }, [scoreParts]);

  const refreshScoreXml = useCallback(async () => {
    setXmlLoading(true);
    setXmlLoadErr('');
    try {
      const r = await fetch(`/api/diagnostic/${jobId}/score-musicxml`, { cache: 'no-store' });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      setRawXml(await r.text());
    } catch (e) {
      setRawXml(null);
      setXmlLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setXmlLoading(false);
    }
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadErr('');
    void (async () => {
      try {
        const [sumRes, polRes, fixesRes, partsRes] = await Promise.all([
          fetch(`/api/diagnostic/${jobId}/summary`, { cache: 'no-store' }),
          fetch(`/api/diagnostic/${jobId}/omr-policy`, { cache: 'no-store' }),
          fetch(`/api/omr-hitl/${jobId}/fixes`, { cache: 'no-store' }),
          fetch(`/api/diagnostic/${jobId}/score-parts`, { cache: 'no-store' }),
        ]);
        if (cancelled) return;
        if (sumRes.ok) setSummary((await sumRes.json()) as InspectSummary);
        if (polRes.ok) setPolicy((await polRes.json()) as OmrPolicy);
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
        if (!cancelled) void refreshScoreXml();
      } catch (e) {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, refreshScoreXml]);

  const partIdForStaff = useCallback(
    (staffLabel: string): string | null => {
      const idx = staffList.indexOf(staffLabel);
      if (idx >= 0 && scoreParts[idx]) return scoreParts[idx].id;
      const hit = scoreParts.find((p) => p.suggestedLabel === staffLabel);
      return hit?.id ?? scoreParts[0]?.id ?? null;
    },
    [staffList, scoreParts],
  );

  const xmlPartIds = useMemo(() => {
    if (!rawXml) return [] as { id: string; name: string }[];
    return parseScoreParts(rawXml);
  }, [rawXml]);

  const resolvePartIdForStaffIndex = useCallback(
    (staffIndex: number): string => {
      if (scoreParts[staffIndex]?.id) return scoreParts[staffIndex].id;
      if (xmlPartIds[staffIndex]?.id) return xmlPartIds[staffIndex].id;
      return scoreParts[0]?.id ?? xmlPartIds[0]?.id ?? '';
    },
    [scoreParts, xmlPartIds],
  );

  const editorPartId = useMemo(() => {
    if (editPartId) return editPartId;
    if (osmdPartId) return osmdPartId;
    if (staffFilter) return partIdForStaff(staffFilter) ?? '';
    if (selectedMeasure) return resolvePartIdForStaffIndex(selectedMeasure.staffIndex);
    return scoreParts[0]?.id ?? xmlPartIds[0]?.id ?? '';
  }, [
    editPartId,
    osmdPartId,
    staffFilter,
    partIdForStaff,
    selectedMeasure,
    resolvePartIdForStaffIndex,
    scoreParts,
    xmlPartIds,
  ]);

  useEffect(() => {
    if (staffFilter) {
      const pid = partIdForStaff(staffFilter);
      setOsmdPartId(pid ?? '');
      setEditPartId(pid ?? '');
    } else {
      setOsmdPartId('');
      setEditPartId('');
    }
  }, [staffFilter, partIdForStaff]);

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
      const j = (await r.json()) as { stats?: { applied?: number; skipped?: number } };
      await refreshScoreXml();
      setEditorKey((k) => k + 1);
      const applied = j.stats?.applied ?? 0;
      const skipped = j.stats?.skipped ?? 0;
      setPendingFixes([]);
      await persistFixes([]);
      setApplyMsg(`MXL에 보정 반영됨 (적용 ${applied}, 건너뜀 ${skipped}). 미리보기가 갱신되었습니다.`);
    } catch (e) {
      setApplyMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyBusy(false);
    }
  }, [jobId, pendingFixes, persistFixes, refreshScoreXml]);

  const handleMeasureClick = useCallback(
    (info: OsmdMeasureClickInfo) => {
      setSelectedMeasure(info);
      if (!staffFilter && !osmdPartId) {
        setEditPartId(resolvePartIdForStaffIndex(info.staffIndex));
      }
      setEditorKey((k) => k + 1);
    },
    [staffFilter, osmdPartId, resolvePartIdForStaffIndex],
  );

  const filteredXml = rawXml ? filterMusicXmlToPart(rawXml, osmdPartId || null) : '';
  const selectedPrinted = selectedMeasure
    ? selectedMeasure.measureMxl + measureOffset
    : null;

  const activePartLabels = scoreParts.map((p) => p.suggestedLabel).filter(Boolean);

  return (
    <div className="modal-light" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: 0 }}>
      <div>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.2rem' }}>OMR 품질 검토 (페이지×성부)</h2>
        <p style={{ margin: 0, lineHeight: 1.55, fontSize: '0.92rem' }}>
          PDF와 MusicXML을 나란히 대조하세요. <strong>오른쪽 악보에서 마디를 클릭</strong>하면 그 마디의
          쉼표·음표·점·이음줄 등을 하나씩 조정할 수 있습니다. 보정을 모은 뒤 「보정 MXL에 적용」→「이어하기」로
          최종 MXL에 반영됩니다(MuseScore 불필요). 성부(
          {activePartLabels.length > 0 ? (
            <strong>{activePartLabels.join(' / ')}</strong>
          ) : (
            <strong>S/A/T/B/PR/PL</strong>
          )}
          ). 인쇄 마디 ≈ MXL <code>measure@number</code> + {measureOffset}.
        </p>
      </div>

      {policy?.audiverisOcrLangEffective != null && (
        <p style={{ margin: 0, fontSize: '0.85rem', color: '#444' }}>
          서버 OCR: <code>{policy.audiverisOcrLangEffective}</code>
        </p>
      )}

      {loadErr ? (
        <div className="omr-lint-warn" role="alert">
          <strong>작업 정보를 일부 불러오지 못했습니다.</strong> {loadErr}
        </div>
      ) : null}

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

      <div className="omr-compare-row">
        <div className="omr-compare-col">
          <div style={{ fontSize: '0.88rem', marginBottom: 6, fontWeight: 600, color: '#333' }}>
            PDF ({pngSource === 'clean_score' ? 'clean_score' : '원본'}) · p.{page} · {pngDpi} DPI
          </div>
          <div className="omr-pdf-frame">
            <img
              alt={`페이지 ${page}`}
              src={`/api/diagnostic/${jobId}/page/${page}/png?source=${pngSource}&dpi=${pngDpi}`}
            />
          </div>
        </div>
        <div className="omr-compare-col omr-compare-col--mxl">
          <div className="omr-mxl-preview-head">
            <span style={{ fontSize: '0.88rem', fontWeight: 600, color: '#333' }}>
              MusicXML (Audiveris MXL)
              {osmdPartId && staffFilter ? ` · ${staffFilter}` : ' · 전체 파트'}
            </span>
            <div className="omr-mxl-preview-controls">
              <label className="omr-zoom-label">
                확대
                <input
                  type="range"
                  min={0.35}
                  max={1.1}
                  step={0.05}
                  value={scoreZoom}
                  onChange={(e) => setScoreZoom(Number(e.target.value))}
                />
              </label>
              <button type="button" className="btn-muted" disabled={xmlLoading} onClick={() => void refreshScoreXml()}>
                {xmlLoading ? '불러오는 중…' : 'MXL 새로고침'}
              </button>
            </div>
          </div>
          <div className="omr-mxl-osmd-frame">
            <InspectPanelErrorBoundary>
              {xmlLoading && !rawXml ? (
                <p className="omr-mxl-osmd-placeholder">MusicXML 불러오는 중…</p>
              ) : xmlLoadErr ? (
                <p className="omr-mxl-osmd-placeholder omr-mxl-osmd-err">{xmlLoadErr}</p>
              ) : filteredXml ? (
                <OsmdBlock
                  xml={filteredXml}
                  zoom={scoreZoom}
                  embeddedInOmrFrame
                  onMeasureClick={handleMeasureClick}
                  highlightMeasureMxl={selectedMeasure?.measureMxl ?? null}
                />
              ) : (
                <p className="omr-mxl-osmd-placeholder">표시할 MusicXML이 없습니다.</p>
              )}
            </InspectPanelErrorBoundary>
          </div>
          <p className="omr-mxl-preview-hint">
            <strong>마디를 클릭</strong>해 편집 패널을 엽니다. 「보정 MXL에 적용」 시 미리보기가 자동 갱신됩니다.
          </p>
        </div>
      </div>

      {selectedMeasure && selectedPrinted != null ? (
        <div className="omr-measure-editor-wrap">
          {!staffFilter && scoreParts.length > 1 && (
            <label className="omr-measure-part-picker">
              편집할 파트
              <select
                value={editorPartId}
                onChange={(e) => setEditPartId(e.target.value)}
              >
                {scoreParts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.suggestedLabel || p.id}
                  </option>
                ))}
              </select>
              <span className="omr-measure-part-picker-hint">
                (클릭한 줄: {scoreParts[selectedMeasure.staffIndex]?.suggestedLabel ?? `staff ${selectedMeasure.staffIndex + 1}`})
              </span>
            </label>
          )}
          {editorPartId ? (
            <OmrMeasureEditor
              key={`${editorPartId}-${selectedMeasure.measureMxl}-${editorKey}`}
              jobId={jobId}
              partId={editorPartId}
              measureMxl={selectedMeasure.measureMxl}
              measurePrinted={selectedPrinted}
              measureOffset={measureOffset}
              staffLabel={
                staffFilter ||
                scoreParts.find((p) => p.id === editorPartId)?.suggestedLabel ||
                undefined
              }
              onAddFix={addFix}
            />
          ) : (
            <p className="omr-measure-editor-err">파트 ID를 찾지 못했습니다. MXL 새로고침 후 다시 클릭하세요.</p>
          )}
        </div>
      ) : (
        <p className="omr-measure-editor-prompt">
          PDF와 MXL이 다른 마디가 있으면 <strong>오른쪽 악보에서 해당 마디를 클릭</strong>하세요.
          {staffFilter === '' ? ' 전체 파트 보기에서는 클릭한 줄의 파트가 자동 선택됩니다.' : ''}
        </p>
      )}

      <div className="omr-hitl-panel">
        <div className="omr-hitl-panel-title">대기 중인 MXL 보정 ({pendingFixes.length}건)</div>
        <p className="omr-hitl-panel-hint">
          마디 편집에서 추가한 보정이 여기 쌓입니다. 「보정 MXL에 적용」으로 Audiveris MXL을 갱신하세요.
          이어하기 시에도 자동 적용됩니다.
        </p>
        {pendingFixes.length > 0 ? (
          <ul className="omr-hitl-fix-list">
            {pendingFixes.map((f) => (
              <li key={f.id}>
                {formatFixSummary(f)}
                <button type="button" className="btn-muted omr-hitl-remove" onClick={() => removeFix(f.id)}>
                  삭제
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="omr-hitl-empty">대기 중인 보정 없음</p>
        )}
        <div className="omr-hitl-actions">
          <button type="button" disabled={applyBusy || pendingFixes.length === 0} onClick={() => void applyFixesToMxl()}>
            {applyBusy ? '적용 중…' : '보정 MXL에 적용'}
          </button>
        </div>
        {applyMsg ? <p className="omr-hitl-apply-msg">{applyMsg}</p> : null}
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
          disabled={continuing || loading}
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
