import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const [manualMeasurePrinted, setManualMeasurePrinted] = useState('');
  const [editorKey, setEditorKey] = useState(0);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [lastPreviewMsg, setLastPreviewMsg] = useState('');
  const [measureClickMsg, setMeasureClickMsg] = useState('');
  const fixesHydratedRef = useRef(false);
  const pendingFixesRef = useRef<OmrHitlFix[]>([]);

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

  useEffect(() => {
    pendingFixesRef.current = pendingFixes;
  }, [pendingFixes]);

  const loadFixesFromServer = useCallback(async (): Promise<OmrHitlFix[]> => {
    const r = await fetch(`/api/omr-hitl/${jobId}/fixes`, { cache: 'no-store' });
    if (!r.ok) return pendingFixesRef.current;
    const j = (await r.json()) as { fixes?: OmrHitlFix[] };
    const list = Array.isArray(j.fixes) ? j.fixes : [];
    setPendingFixes((prev) => (prev.length >= list.length ? prev : list));
    return list.length > 0 ? list : pendingFixesRef.current;
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
        if (fixesRes.ok && !fixesHydratedRef.current) {
          fixesHydratedRef.current = true;
          const fj = (await fixesRes.json()) as { fixes?: OmrHitlFix[] };
          if (Array.isArray(fj.fixes)) {
            setPendingFixes((prev) => (prev.length > 0 ? prev : fj.fixes!));
          }
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

  /** 클릭 정보의 partId(OSMD가 확정한 MusicXML part id)를 우선 사용. 줄 인덱스 추측은 폴백. */
  const resolvePartIdForMeasure = useCallback(
    (info: OsmdMeasureClickInfo): string => {
      const pid = info.partId?.trim();
      if (pid && (scoreParts.some((p) => p.id === pid) || xmlPartIds.some((p) => p.id === pid))) {
        return pid;
      }
      return resolvePartIdForStaffIndex(info.staffIndex);
    },
    [scoreParts, xmlPartIds, resolvePartIdForStaffIndex],
  );

  const labelForPartId = useCallback(
    (partId: string): string | null => {
      const hit = scoreParts.find((p) => p.id === partId);
      if (hit?.suggestedLabel) return hit.suggestedLabel;
      const xmlHit = xmlPartIds.find((p) => p.id === partId);
      return xmlHit?.name ?? null;
    },
    [scoreParts, xmlPartIds],
  );

  const editorPartId = useMemo(() => {
    if (editPartId) return editPartId;
    if (osmdPartId) return osmdPartId;
    if (staffFilter) return partIdForStaff(staffFilter) ?? '';
    if (selectedMeasure) return resolvePartIdForMeasure(selectedMeasure);
    return scoreParts[0]?.id ?? xmlPartIds[0]?.id ?? '';
  }, [
    editPartId,
    osmdPartId,
    staffFilter,
    partIdForStaff,
    selectedMeasure,
    resolvePartIdForMeasure,
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
        if (next.length === prev.length) return prev;
        void persistFixes(next)
          .then(() => loadFixesFromServer())
          .catch((e) => {
            console.error(e);
            alert(e instanceof Error ? e.message : String(e));
          });
        return next;
      });
    },
    [persistFixes, loadFixesFromServer],
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

  const normalizeRests = useCallback(async () => {
    setApplyBusy(true);
    setApplyMsg('');
    setLastPreviewMsg('');
    try {
      const r = await fetch(`/api/omr-hitl/${jobId}/normalize-rests`, { method: 'POST' });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      const j = (await r.json()) as { stats?: { restsFixed?: number; measuresChanged?: number } };
      await refreshScoreXml();
      setPreviewRevision((n) => n + 1);
      setEditorKey((k) => k + 1);
      const fixed = j.stats?.restsFixed ?? 0;
      const msg =
        fixed > 0
          ? `쉼표 길이 자동 정리됨 — 전체 성부에서 ${fixed}건 (마디 ${j.stats?.measuresChanged ?? 0}곳). 오른쪽 악보에서 확인하세요.`
          : '자동 정리 대상 쉼표가 없습니다 (마디 길이를 넘는 점 없는 쉼표가 없음).';
      setApplyMsg(msg);
      setLastPreviewMsg(msg);
    } catch (e) {
      setApplyMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyBusy(false);
    }
  }, [jobId, refreshScoreXml]);

  const applyFixesToMxl = useCallback(async () => {
    setApplyBusy(true);
    setApplyMsg('');
    setLastPreviewMsg('');
    try {
      let fixes = pendingFixesRef.current;
      if (fixes.length === 0) {
        fixes = await loadFixesFromServer();
      }
      if (fixes.length === 0) {
        setApplyMsg('반영할 보정이 없습니다. 마디 편집에서 삭제·추가 버튼을 먼저 누르세요.');
        return;
      }
      await persistFixes(fixes);
      setPendingFixes(fixes);
      const r = await fetch(`/api/omr-hitl/${jobId}/apply`, { method: 'POST' });
      if (!r.ok) {
        const j = (await r.json()) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      const j = (await r.json()) as { stats?: { applied?: number; skipped?: number } };
      await refreshScoreXml();
      setPreviewRevision((n) => n + 1);
      setEditorKey((k) => k + 1);
      const applied = j.stats?.applied ?? 0;
      const skipped = j.stats?.skipped ?? 0;
      const msg =
        applied === 0 && skipped > 0
          ? `반영된 보정이 없습니다 (건너뜀 ${skipped}). 이미 반영됐거나 대상 요소를 찾지 못한 보정입니다 — 마디 편집을 다시 열어 현재 상태를 확인하세요.`
          : `MXL에 반영됨 (적용 ${applied}, 건너뜀 ${skipped}). 오른쪽 MusicXML에서 확인하세요.`;
      setApplyMsg(msg);
      setLastPreviewMsg(msg);
    } catch (e) {
      setApplyMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyBusy(false);
    }
  }, [jobId, persistFixes, refreshScoreXml, loadFixesFromServer]);

  const openMeasure = useCallback(
    (info: OsmdMeasureClickInfo) => {
      setSelectedMeasure(info);
      const printed = info.measureMxl + measureOffset;
      setManualMeasurePrinted(String(printed));
      const partId = resolvePartIdForMeasure(info);
      const staffLabel =
        labelForPartId(partId) ??
        staffList[info.staffIndex] ??
        `줄 ${info.staffIndex + 1}`;
      setMeasureClickMsg(
        `마디 선택됨 · 인쇄 ${printed} · MXL ${info.measureMxl} · ${staffLabel}`,
      );
      if (!staffFilter) {
        setEditPartId(partId);
      }
      setEditorKey((k) => k + 1);
    },
    [staffFilter, measureOffset, resolvePartIdForMeasure, labelForPartId, staffList],
  );

  const openManualMeasure = useCallback(() => {
    const printed = parseInt(manualMeasurePrinted.trim(), 10);
    if (!Number.isFinite(printed) || printed < 1) return;
    const measureMxl = Math.max(1, printed - measureOffset);
    const staffIndex = staffFilter
      ? Math.max(0, staffList.indexOf(staffFilter))
      : 0;
    openMeasure({
      measureMxl,
      staffIndex,
      partId: staffFilter ? partIdForStaff(staffFilter) : null,
    });
    if (!staffFilter && !editPartId) {
      setEditPartId(resolvePartIdForStaffIndex(staffIndex));
    }
  }, [
    manualMeasurePrinted,
    measureOffset,
    staffFilter,
    staffList,
    openMeasure,
    editPartId,
    partIdForStaff,
    resolvePartIdForStaffIndex,
  ]);

  const filteredXml = rawXml ? filterMusicXmlToPart(rawXml, osmdPartId || null) : '';
  const selectedPrinted = selectedMeasure ? selectedMeasure.measureMxl + measureOffset : null;

  const activePartLabels = scoreParts.map((p) => p.suggestedLabel).filter(Boolean);

  return (
    <div className="modal-light" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: 0 }}>
      <div>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.2rem' }}>OMR 품질 검토 (페이지×성부)</h2>
        <p style={{ margin: 0, lineHeight: 1.55, fontSize: '0.92rem' }}>
          PDF와 MusicXML을 나란히 대조하세요. 오른쪽 악보에서 <strong>마디를 클릭</strong>해 쉼표·음표·점 등을
          조정하고, 「MXL에 반영·미리보기」로 오른쪽 악보에서 확인한 뒤 「이어하기」로
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
                  key={`osmd-preview-${previewRevision}`}
                  xml={filteredXml}
                  zoom={scoreZoom}
                  embeddedInOmrFrame
                  onMeasureClick={openMeasure}
                  highlightMeasureMxl={selectedMeasure?.measureMxl ?? null}
                  highlightMeasureStaffIndex={selectedMeasure?.staffIndex ?? null}
                />
              ) : (
                <p className="omr-mxl-osmd-placeholder">표시할 MusicXML이 없습니다.</p>
              )}
            </InspectPanelErrorBoundary>
          </div>
          <p className="omr-mxl-preview-hint">
            <strong>오선·음표</strong> 위에 마우스를 올리면 마디가 하늘색으로 표시되고, 클릭하면 편집 패널이 열립니다.
            {staffFilter === '' ? ' 전체 파트 보기에서는 클릭한 줄의 성부가 자동 선택됩니다.' : ''}
          </p>
          {measureClickMsg ? (
            <p className="omr-mxl-preview-hint" style={{ color: '#1565c0', fontWeight: 600 }}>
              {measureClickMsg}
            </p>
          ) : null}
          <div className="omr-manual-measure-open">
            <label>
              인쇄 마디로 열기(보조)
              <input
                type="number"
                min={1}
                value={manualMeasurePrinted}
                onChange={(e) => setManualMeasurePrinted(e.target.value)}
                placeholder="인쇄 마디"
                style={{ width: 72, marginLeft: 6 }}
              />
            </label>
            <button type="button" className="btn-muted" onClick={() => openManualMeasure()}>
              마디 편집 열기
            </button>
          </div>
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
                (클릭한 줄: {labelForPartId(resolvePartIdForMeasure(selectedMeasure)) ?? staffList[selectedMeasure.staffIndex] ?? `줄 ${selectedMeasure.staffIndex + 1}`})
              </span>
            </label>
          )}
          {editorPartId ? (
            <OmrMeasureEditor
              key={`${editorPartId}-${selectedMeasure.measureMxl}-${editorKey}-${previewRevision}`}
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
              previewRevision={previewRevision}
              lastPreviewMsg={lastPreviewMsg}
              pendingFixCount={pendingFixes.length}
              previewBusy={applyBusy}
              onPreview={() => void applyFixesToMxl()}
              onAddFix={addFix}
            />
          ) : (
            <p className="omr-measure-editor-err">파트 ID를 찾지 못했습니다. MXL 새로고침 후 다시 클릭하세요.</p>
          )}
        </div>
      ) : (
        <p className="omr-measure-editor-prompt">
          PDF와 MXL이 다른 마디가 있으면 오른쪽 악보에서 <strong>해당 마디를 클릭</strong>하세요.
          {staffFilter === '' ? ' 전체 파트 보기에서는 클릭한 줄의 성부가 자동 선택됩니다.' : ''}
        </p>
      )}

      <div className="omr-hitl-panel">
        <div className="omr-hitl-panel-title">대기 중인 MXL 보정 ({pendingFixes.length}건)</div>
        <p className="omr-hitl-panel-hint">
          마디 편집에서 추가한 보정이 여기 쌓입니다. <strong>「MXL에 반영·미리보기」</strong>로 Audiveris MXL을
          갱신하고 오른쪽 악보에서 확인하세요. 이어하기 시에도 자동 적용됩니다.
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
          {!selectedMeasure && (
            <button type="button" disabled={applyBusy} onClick={() => void applyFixesToMxl()}>
              {applyBusy ? '반영 중…' : `MXL에 반영·미리보기${pendingFixes.length > 0 ? ` (${pendingFixes.length}건)` : ''}`}
            </button>
          )}
          <button
            type="button"
            className="btn-muted"
            disabled={applyBusy}
            onClick={() => void normalizeRests()}
            title="점 없는 쉼표인데 duration이 마디 길이를 넘는 경우(미리보기에 없던 점이 보이는 원인)를 전체 성부에서 한 번에 정리합니다"
          >
            {applyBusy ? '정리 중…' : '쉼표 길이 자동 정리 (전체 성부)'}
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
