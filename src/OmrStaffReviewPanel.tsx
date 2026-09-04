import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  buildOsmdPreviewXml,
  buildStaffFilterEntries,
  type ScorePartForPreview,
  type StaffFilterEntry,
  InspectPanelErrorBoundary,
  OsmdBlock,
  parseScoreParts,
  resolveMusicXmlPartFromPreviewId,
  staveCountForPart,
} from './AudiverisInspectPanel';
import { OmrMeasureEditor } from './OmrMeasureEditor';
import { formatFixSummary, mergeFix, type OmrHitlFix } from './omrHitlFixes';
import { extraYPxFromArticulationFixes } from './osmdArticulationOffsetFix';
import type { OsmdMeasureClickInfo } from './osmdMeasureClick';
import { resolvePartDisplayLabels } from './partLabelOptions';
import {
  buildPdfPageMeasureIndex,
  filterMusicXmlToMeasureRange,
  inferPdfPageForMxlMeasure,
  measureRangeFromPageIndex,
} from '../shared/musicXmlMeasureRange';
type ScorePartRow = ScorePartForPreview & {
  index: number;
};

/** 이미지 PDF HITL — 페이지 넘김 시 전체/페이지 OSMD 대신 선택 마디만 그림. */
const IMAGE_PDF_LIGHT_PIPELINE = 'image_pdf';
const PNG_DPI_DEFAULT = 156;
const PNG_DPI_IMAGE_LIGHT = 72;
const PNG_MAX_SIDE_IMAGE_LIGHT = 1200;

/** PDF 페이지 PNG — src 교체만으로 멈추지 않게 선로드 + 로딩 표시. */
function DiagnosticPagePng(props: {
  jobId: string;
  page: number;
  source: string;
  dpi: number;
  maxSide?: number;
}) {
  const { jobId, page, source, dpi, maxSide } = props;
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ source, dpi: String(dpi) });
    if (maxSide && maxSide > 0) qs.set('maxSide', String(maxSide));
    const href = `/api/diagnostic/${jobId}/page/${page}/png?${qs.toString()}`;
    setPhase('loading');
    const ac = new AbortController();
    (async () => {
      try {
        const r = await fetch(href, { cache: 'force-cache', signal: ac.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = url;
        setBlobUrl(url);
        setPhase('ready');
      } catch (e) {
        if (cancelled || (e instanceof DOMException && e.name === 'AbortError')) return;
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [jobId, page, source, dpi, maxSide]);

  useEffect(
    () => () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    },
    [],
  );

  if (phase === 'error') {
    return (
      <p style={{ padding: '1rem', color: '#a00', lineHeight: 1.5 }}>
        PDF 페이지 {page} 미리보기를 불러오지 못했습니다. 마디 번호로 먼저 이동해 보세요.
      </p>
    );
  }
  return (
    <div style={{ position: 'relative', minHeight: 120 }}>
      {phase === 'loading' ? (
        <p style={{ padding: '0.75rem', color: '#555', margin: 0 }}>
          PDF p.{page} 렌더 중… (이미지 PDF는 첫 로드만 시간이 걸릴 수 있습니다)
        </p>
      ) : null}
      {blobUrl ? (
        <img
          alt={`페이지 ${page}`}
          src={blobUrl}
          style={{
            maxWidth: '100%',
            height: 'auto',
            display: 'block',
            opacity: phase === 'ready' ? 1 : 0.35,
          }}
        />
      ) : null}
    </div>
  );
}

/** Accent 거리 등 — OSMD 미리보기용 (MXL 반영 후에도 pending이 비워져도 유지). */
function isArticulationPreviewFix(f: OmrHitlFix): boolean {
  return (
    (f.kind === 'setArticulationPlacement' || f.kind === 'addArticulation') &&
    Boolean(f.articulation)
  );
}

function isDynamicsPreviewFix(f: OmrHitlFix): boolean {
  return (
    (f.kind === 'setNoteDirectionPlacement' || f.kind === 'addNoteDirection') &&
    f.directionType === 'dynamics'
  );
}

function isOsmdPreviewFix(f: OmrHitlFix): boolean {
  return isArticulationPreviewFix(f) || isDynamicsPreviewFix(f);
}

function mergeArticulationPreviewFixes(prev: OmrHitlFix[], incoming: OmrHitlFix[]): OmrHitlFix[] {
  let next = prev;
  for (const f of incoming) {
    if (!isOsmdPreviewFix(f)) continue;
    next = mergeFix(next, f);
  }
  return next;
}

type OmrPolicy = {
  audiverisOcrLangEffective?: string | null;
  pCauses?: string[];
};

type InspectSummary = {
  pageCountForUi: number;
  pipelineMode?: string;
  imagePdfOmrEngine?: string | null;
  cleanScorePdf?: { exists: boolean };
  audiverisInputPdf?: string | null;
  activeOmrEngine?: string;
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
  const [pagePending, startPageTransition] = useTransition();
  const [loadErr, setLoadErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [pendingFixes, setPendingFixes] = useState<OmrHitlFix[]>([]);
  /** MXL 반영 후 대기 목록은 비우지만, Accent 거리 OSMD 미리보기는 이 목록으로 유지(XML 힌트 매칭 실패 대비). */
  const [artPreviewFixes, setArtPreviewFixes] = useState<OmrHitlFix[]>([]);
  const [scoreParts, setScoreParts] = useState<ScorePartRow[]>([]);
  const [applyBusy, setApplyBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportPercent, setExportPercent] = useState(0);
  const [applyMsg, setApplyMsg] = useState('');
  const [rawXml, setRawXml] = useState<string | null>(null);
  const [xmlLoading, setXmlLoading] = useState(false);
  const [xmlLoadErr, setXmlLoadErr] = useState('');
  const [osmdPartId, setOsmdPartId] = useState('');
  const [scoreZoom, setScoreZoom] = useState(0.55);
  const [selectedMeasure, setSelectedMeasure] = useState<OsmdMeasureClickInfo | null>(null);
  const [editPartId, setEditPartId] = useState('');
  const [manualMeasureMxl, setManualMeasureMxl] = useState('');
  const [editorKey, setEditorKey] = useState(0);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [scrollToMeasureTrigger, setScrollToMeasureTrigger] = useState(0);
  const [pageScrollTarget, setPageScrollTarget] = useState<OsmdMeasureClickInfo | null>(null);
  const [lastPreviewMsg, setLastPreviewMsg] = useState('');
  const [measureClickMsg, setMeasureClickMsg] = useState('');
  const fixesHydratedRef = useRef(false);
  const previewSyncedRef = useRef(false);
  const pendingFixesRef = useRef<OmrHitlFix[]>([]);
  const importWorkInputRef = useRef<HTMLInputElement>(null);
  const importRangeInputRef = useRef<HTMLInputElement>(null);
  const [workMsg, setWorkMsg] = useState('');
  const [rangeImportStart, setRangeImportStart] = useState(33);
  const [rangeImportEnd, setRangeImportEnd] = useState(65);
  const [rangeImportTargetStart, setRangeImportTargetStart] = useState<number | ''>('');
  const [rangeImportOpen, setRangeImportOpen] = useState(false);

  const pageCount = Math.max(1, summary?.pageCountForUi ?? 1);
  /** image_pdf 파이프라인 또는 omr-work manifest의 imagePdfOmrEngine — 경량 HITL */
  const imagePdfLight =
    summary?.pipelineMode === IMAGE_PDF_LIGHT_PIPELINE ||
    Boolean(summary?.imagePdfOmrEngine);
  const pngSource =
    summary?.cleanScorePdf?.exists || summary?.audiverisInputPdf === 'clean_score'
      ? 'clean_score'
      : 'original';
  /** 이미지 PDF는 스캔 PNG가 커서 페이지 넘김 DPI·긴 변을 낮춤. */
  const pngDpi = imagePdfLight ? PNG_DPI_IMAGE_LIGHT : PNG_DPI_DEFAULT;
  const pngMaxSide = imagePdfLight ? PNG_MAX_SIDE_IMAGE_LIGHT : undefined;
  /** OSMD 재구성은 deferred — 페이지 버튼·PNG는 즉시 반응. */
  const deferredPage = useDeferredValue(page);

  /** rawXml당 1회 — 페이지 넘김마다 전체 MusicXML DOM 재파싱 금지 */
  const pageMeasureIndex = useMemo(
    () => (rawXml ? buildPdfPageMeasureIndex(rawXml) : { pageStarts: [1], maxMeasure: 1 }),
    [rawXml],
  );

  const staffFilterEntries = useMemo(
    () => buildStaffFilterEntries(scoreParts, rawXml),
    [scoreParts, rawXml],
  );

  const staffList = useMemo(() => {
    if (staffFilterEntries.length) return staffFilterEntries.map((e) => e.label);
    const fromParts = scoreParts.map((p) => p.displayLabel || p.suggestedLabel).filter(Boolean);
    if (fromParts.length) return fromParts;
    return [...STAFF_FALLBACK];
  }, [staffFilterEntries, scoreParts]);

  /** 이미지 PDF 경량 모드 — 성부 미선택이면 첫 성부 자동(전체 파트 OSMD 금지). */
  useEffect(() => {
    if (!imagePdfLight || staffFilter || !staffList.length) return;
    setStaffFilter(staffList[0]!);
  }, [imagePdfLight, staffFilter, staffList]);

  const activeStaffFilter = useMemo((): StaffFilterEntry | null => {
    if (!staffFilter) return null;
    return staffFilterEntries.find((e) => e.label === staffFilter) ?? null;
  }, [staffFilter, staffFilterEntries]);

  /** PDF 페이지 → MXL 마디 구간 (캐시된 pageStarts — apply 메시지·네비용) */
  const pageMeasureRange = useMemo(
    () => measureRangeFromPageIndex(pageMeasureIndex, page),
    [pageMeasureIndex, page],
  );

  const deferredPageMeasureRange = useMemo(
    () => measureRangeFromPageIndex(pageMeasureIndex, deferredPage),
    [pageMeasureIndex, deferredPage],
  );

  useEffect(() => {
    if (!rawXml || page < 1) return;
    if (imagePdfLight) return; // 마디 단위 미리보기 — 페이지 스크롤 대상 불필요
    const mxl = pageMeasureIndex.pageStarts[Math.min(page, pageMeasureIndex.pageStarts.length) - 1] ?? 1;
    if (mxl < 1) return;
    setPageScrollTarget({ measureMxl: mxl, staffIndex: 0, partId: null });
    setScrollToMeasureTrigger((t) => t + 1);
  }, [page, rawXml, imagePdfLight, pageMeasureIndex]);

  useEffect(() => {
    if (!imagePdfLight || page >= pageCount) return;
    const qs = new URLSearchParams({
      source: pngSource,
      dpi: String(pngDpi),
      maxSide: String(PNG_MAX_SIDE_IMAGE_LIGHT),
    });
    const next = page + 1;
    const href = `/api/diagnostic/${jobId}/page/${next}/png?${qs.toString()}`;
    const idle =
      typeof requestIdleCallback === 'function'
        ? requestIdleCallback(() => {
            void fetch(href, { cache: 'force-cache' }).catch(() => undefined);
          })
        : window.setTimeout(() => {
            void fetch(href, { cache: 'force-cache' }).catch(() => undefined);
          }, 400);
    return () => {
      if (typeof cancelIdleCallback === 'function' && typeof idle === 'number') {
        try {
          cancelIdleCallback(idle as number);
        } catch {
          /* ignore */
        }
      } else {
        window.clearTimeout(idle as number);
      }
    };
  }, [imagePdfLight, page, pageCount, jobId, pngSource, pngDpi]);

  const goToPage = useCallback(
    (next: number) => {
      const clamped = Math.max(1, Math.min(pageCount, next));
      startPageTransition(() => {
        setPage(clamped);
        // 이미지 PDF: 페이지 넘김 시 이전 마디 OSMD를 비워 메인 스레드 부담을 줄임
        if (imagePdfLight) {
          setSelectedMeasure(null);
          setMeasureClickMsg('');
        }
      });
    },
    [pageCount, imagePdfLight],
  );

  const refreshScoreXml = useCallback(async (opts?: { skipSync?: boolean }) => {
    setXmlLoading(true);
    setXmlLoadErr('');
    try {
      const q = opts?.skipSync ? '?skipSync=1' : '';
      const r = await fetch(`/api/diagnostic/${jobId}/score-musicxml${q}`, { cache: 'no-store' });
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

  const applyScorePartsResponse = useCallback(
    (pj: {
      parts?: Array<{
        id: string;
        index: number;
        name?: string;
        instrumentName?: string;
        suggestedLabel: string;
        displayLabel?: string;
      }>;
      presetLabelsByIndex?: string[];
      savedLabelsByIndex?: string[];
    }) => {
      const list = Array.isArray(pj.parts) ? pj.parts : [];
      const displayLabels = resolvePartDisplayLabels(
        list.map((p) => ({
          index: p.index,
          name: p.name,
          instrumentName: p.instrumentName,
          suggestedLabel: p.suggestedLabel,
        })),
        pj.savedLabelsByIndex,
        pj.presetLabelsByIndex,
      );
      setScoreParts(
        list.map((p) => ({
          id: p.id,
          index: p.index,
          suggestedLabel: p.suggestedLabel,
          displayLabel: p.displayLabel ?? displayLabels[p.index] ?? p.suggestedLabel,
        })),
      );
    },
    [],
  );

  const refreshPanelAfterWorkImport = useCallback(async () => {
    const [fixesRes, partsRes, sumRes] = await Promise.all([
      fetch(`/api/omr-hitl/${jobId}/fixes`, { cache: 'no-store' }),
      fetch(`/api/diagnostic/${jobId}/score-parts`, { cache: 'no-store' }),
      fetch(`/api/diagnostic/${jobId}/summary`, { cache: 'no-store' }),
    ]);
    if (fixesRes.ok) {
      const fj = (await fixesRes.json()) as { fixes?: OmrHitlFix[] };
      if (Array.isArray(fj.fixes)) setPendingFixes(fj.fixes);
    }
    if (partsRes.ok) {
      applyScorePartsResponse(
        (await partsRes.json()) as Parameters<typeof applyScorePartsResponse>[0],
      );
    }
    if (sumRes.ok) setSummary((await sumRes.json()) as InspectSummary);
    await refreshScoreXml();
    setArtPreviewFixes([]);
    setPreviewRevision((n) => n + 1);
    setEditorKey((k) => k + 1);
  }, [jobId, refreshScoreXml, applyScorePartsResponse]);

  useEffect(() => {
    pendingFixesRef.current = pendingFixes;
  }, [pendingFixes]);

  useEffect(() => {
    setArtPreviewFixes([]);
  }, [jobId]);

  const loadFixesFromServer = useCallback(async (): Promise<OmrHitlFix[]> => {
    const r = await fetch(`/api/omr-hitl/${jobId}/fixes`, { cache: 'no-store' });
    if (!r.ok) return pendingFixesRef.current;
    const j = (await r.json()) as { fixes?: OmrHitlFix[] };
    const list = Array.isArray(j.fixes) ? j.fixes : [];
    setPendingFixes(list);
    return list;
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
            setPendingFixes(fj.fixes);
          }
        }
        if (partsRes.ok) {
          applyScorePartsResponse(
            (await partsRes.json()) as Parameters<typeof applyScorePartsResponse>[0],
          );
        }
        if (!cancelled) {
          await refreshScoreXml();
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
  }, [jobId, refreshScoreXml, applyScorePartsResponse]);

  const partIdForStaff = useCallback(
    (staffLabel: string): string | null => {
      const entry = staffFilterEntries.find((e) => e.label === staffLabel);
      if (entry) return entry.partId;
      const idx = staffList.indexOf(staffLabel);
      if (idx >= 0 && scoreParts[idx]) return scoreParts[idx].id;
      const hit = scoreParts.find((p) => (p.displayLabel || p.suggestedLabel) === staffLabel);
      return hit?.id ?? scoreParts[0]?.id ?? null;
    },
    [staffFilterEntries, staffList, scoreParts],
  );

  const staffWithinPartForLabel = useCallback(
    (staffLabel: string): number | null => {
      const entry = staffFilterEntries.find((e) => e.label === staffLabel);
      return entry?.staffWithinPart ?? null;
    },
    [staffFilterEntries],
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
      if (pid) {
        const resolved = resolveMusicXmlPartFromPreviewId(pid);
        if (
          scoreParts.some((p) => p.id === resolved.partId) ||
          xmlPartIds.some((p) => p.id === resolved.partId)
        ) {
          return resolved.partId;
        }
      }
      return resolvePartIdForStaffIndex(info.staffIndex);
    },
    [scoreParts, xmlPartIds, resolvePartIdForStaffIndex],
  );

  const labelForPartId = useCallback(
    (partId: string): string | null => {
      const hit = scoreParts.find((p) => p.id === partId);
      if (hit?.displayLabel) return hit.displayLabel;
      if (hit?.suggestedLabel) return hit.suggestedLabel;
      const xmlHit = xmlPartIds.find((p) => p.id === partId);
      return xmlHit?.name ?? null;
    },
    [scoreParts, xmlPartIds],
  );

  const labelForPartStaff = useCallback(
    (partId: string, staffWithinPart?: number | null): string | null => {
      const entry = staffFilterEntries.find(
        (e) => e.partId === partId && (e.staffWithinPart ?? null) === (staffWithinPart ?? null),
      );
      if (entry) return entry.label;
      const staves = rawXml ? staveCountForPart(rawXml, partId) : 1;
      if (staves >= 2) {
        if (staffWithinPart === 2) return 'PL';
        if (staffWithinPart === 1) return 'PR';
      }
      return labelForPartId(partId);
    },
    [staffFilterEntries, rawXml, labelForPartId],
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

  const editStaffWithinPart = useMemo((): number | null => {
    if (activeStaffFilter?.staffWithinPart) return activeStaffFilter.staffWithinPart;
    const clickPid = selectedMeasure?.partId?.trim();
    if (clickPid) {
      const fromPreview = resolveMusicXmlPartFromPreviewId(clickPid);
      if (fromPreview.staffWithinPart) return fromPreview.staffWithinPart;
    }
    const pid = editorPartId;
    if (!pid || !rawXml || staveCountForPart(rawXml, pid) < 2) return null;
    return selectedMeasure?.staffWithinPart ?? null;
  }, [activeStaffFilter, editorPartId, rawXml, selectedMeasure]);

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

  const persistFixesDebounced = useCallback(
    (fixes: OmrHitlFix[]) => {
      void persistFixes(fixes).catch((e) => {
        console.error(e);
        alert(e instanceof Error ? e.message : String(e));
      });
    },
    [persistFixes],
  );

  const addFix = useCallback(
    (fix: OmrHitlFix) => {
      setPendingFixes((prev) => {
        const next = mergeFix(prev, fix);
        if (next === prev) return prev;
        persistFixesDebounced(next);
        return next;
      });
    },
    [persistFixesDebounced],
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
      const j = (await r.json()) as {
        stats?: {
          restsFixed?: number;
          measuresChanged?: number;
          restDisplayCleared?: number;
          tupletStaccatoRemoved?: number;
          slursInjected?: number;
          tupletShowNumberFixed?: number;
        };
      };
      await refreshScoreXml({ skipSync: true });
      setPreviewRevision((n) => n + 1);
      const fixed = j.stats?.restsFixed ?? 0;
      const displayCleared = j.stats?.restDisplayCleared ?? 0;
      const staccatoRemoved = j.stats?.tupletStaccatoRemoved ?? 0;
      const slurs = j.stats?.slursInjected ?? 0;
      const tupletShow = j.stats?.tupletShowNumberFixed ?? 0;
      const any =
        fixed > 0 || displayCleared > 0 || staccatoRemoved > 0 || slurs > 0 || tupletShow > 0;
      const msg = any
        ? `자동 정리됨 — 쉼표 ${fixed}건, 쉼표 위치 ${displayCleared}건, 이음줄 ${slurs}쌍, 세잇단 숫자 ${tupletShow}건, 가짜 점 ${staccatoRemoved}건. 오른쪽 악보에서 확인하세요.`
        : '자동 정리 대상이 없습니다.';
      setApplyMsg(msg);
      setLastPreviewMsg(msg);
    } catch (e) {
      setApplyMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyBusy(false);
    }
  }, [jobId, refreshScoreXml]);

  useEffect(() => {
    if (loading || previewSyncedRef.current) return;
    previewSyncedRef.current = true;
    void (async () => {
      try {
        const r = await fetch(`/api/omr-hitl/${jobId}/sync-preview`, { method: 'POST' });
        if (r.ok) await refreshScoreXml();
      } catch {
        /* 첫 동기화 실패는 무시 */
      }
    })();
  }, [loading, jobId, refreshScoreXml]);

  const exportWork = useCallback(async () => {
    setWorkMsg('');
    setExportBusy(true);
    setExportPercent(1);
    const started = Date.now();
    try {
      const start = await fetch(`/api/omr-hitl/${jobId}/export-work/start`, { method: 'POST' });
      if (!start.ok) {
        const j = (await start.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${start.status}`);
      }
      for (;;) {
        if (Date.now() - started > 15 * 60 * 1000) {
          throw new Error('작업 저장이 너무 오래 걸립니다. 서버 로그를 확인하세요.');
        }
        await new Promise((r) => setTimeout(r, 400));
        const st = await fetch(`/api/omr-hitl/${jobId}/export-work/status`);
        const j = (await st.json().catch(() => ({}))) as {
          percent?: number;
          detail?: string;
          done?: boolean;
          error?: string | null;
        };
        if (!st.ok) throw new Error(j.error ?? `HTTP ${st.status}`);
        if (typeof j.percent === 'number') setExportPercent(Math.max(0, Math.min(100, j.percent)));
        if (j.error) throw new Error(j.error);
        if (j.done) break;
      }
      setExportPercent(100);
      const r = await fetch(`/api/omr-hitl/${jobId}/export-work/file`);
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `omr-work-${jobId.slice(0, 8)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setWorkMsg('검토 진행 ZIP을 저장했습니다. 나중에 같은 변환 작업에서 「작업 불러오기」로 복원하세요.');
    } catch (e) {
      setWorkMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setExportBusy(false);
      setExportPercent(0);
    }
  }, [jobId]);

  const importWork = useCallback(
    async (file: File) => {
      setWorkMsg('');
      setApplyBusy(true);
      try {
        const fd = new FormData();
        fd.append('file', file);
        const r = await fetch(`/api/omr-hitl/${jobId}/import-work`, { method: 'POST', body: fd });
        const j = (await r.json()) as {
          error?: string;
          fixCount?: number;
          stats?: { syncMode?: string; hitlApplied?: number };
        };
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        await refreshPanelAfterWorkImport();
        const mode = j.stats?.syncMode ?? '';
        const applied = j.stats?.hitlApplied ?? 0;
        setWorkMsg(
          `작업 불러옴 — 보정 기록 ${j.fixCount ?? 0}건${applied > 0 ? `, MXL 반영 ${applied}건` : ''}${mode ? ` (${mode})` : ''}. 미리보기를 갱신했습니다.`,
        );
      } catch (e) {
        setWorkMsg(e instanceof Error ? e.message : String(e));
      } finally {
        setApplyBusy(false);
      }
    },
    [jobId, refreshPanelAfterWorkImport],
  );

  const importMeasureRange = useCallback(
    async (file: File) => {
      if (rangeImportStart < 1 || rangeImportEnd < rangeImportStart) {
        setWorkMsg('출처 마디 범위(시작 ≤ 끝, 1 이상)를 확인하세요.');
        return;
      }
      setWorkMsg('');
      setApplyBusy(true);
      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('sourceStartMeasure', String(rangeImportStart));
        fd.append('sourceEndMeasure', String(rangeImportEnd));
        if (rangeImportTargetStart !== '' && rangeImportTargetStart >= 1) {
          fd.append('targetStartMeasure', String(rangeImportTargetStart));
        }
        const r = await fetch(`/api/omr-hitl/${jobId}/import-measure-range`, {
          method: 'POST',
          body: fd,
        });
        const j = (await r.json()) as {
          error?: string;
          stats?: { parts?: number; measuresCopied?: number; measuresSkipped?: number; targetStart?: number };
        };
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        await refreshScoreXml({ skipSync: true });
        setPreviewRevision((n) => n + 1);
        const st = j.stats;
        const tgt =
          st?.targetStart != null && st.targetStart !== rangeImportStart
            ? ` → 대상 m.${st.targetStart}~`
            : '';
        setWorkMsg(
          `이전 작업 m.${rangeImportStart}~${rangeImportEnd}${tgt} 구간을 가져왔습니다 — ${st?.parts ?? 0}개 파트, ${st?.measuresCopied ?? 0}마디 복사${(st?.measuresSkipped ?? 0) > 0 ? ` (건너뜀 ${st?.measuresSkipped})` : ''}.`,
        );
      } catch (e) {
        setWorkMsg(e instanceof Error ? e.message : String(e));
      } finally {
        setApplyBusy(false);
      }
    },
    [
      jobId,
      rangeImportStart,
      rangeImportEnd,
      rangeImportTargetStart,
      refreshScoreXml,
    ],
  );

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
      const j = (await r.json()) as {
        stats?: { applied?: number; skipped?: number; pendingCleared?: number; syncMode?: string };
        affectedMeasures?: Array<{ partId: string; measureMxl: number }>;
      };
      await refreshScoreXml({ skipSync: true });
      setPreviewRevision((n) => n + 1);
      // Accent 거리 미리보기는 pending 경로로만 안정적으로 동작 — 반영 후에도 OSMD에 넘김
      setArtPreviewFixes((prev) => mergeArticulationPreviewFixes(prev, fixes));
      setPendingFixes([]);
      pendingFixesRef.current = [];
      const applied = j.stats?.applied ?? 0;
      const skipped = j.stats?.skipped ?? 0;
      const cleared = j.stats?.pendingCleared ?? 0;
      const mode = j.stats?.syncMode ?? '';
      const msg =
        applied === 0 && skipped > 0
          ? `반영된 보정이 없습니다 (건너뜀 ${skipped}). 이미 반영됐거나 대상 요소를 찾지 못한 보정입니다 — 마디 편집을 다시 열어 현재 상태를 확인하세요.`
          : cleared > 0
            ? `MXL에 반영됨 (적용 ${applied}, 건너뜀 ${skipped}) — 대기 목록 ${cleared}건 제거${mode ? ` · ${mode}` : ''}. 현재 PDF 페이지(m.${pageMeasureRange.start}–${pageMeasureRange.end}) 미리보기 갱신.`
            : `MXL에 반영됨 (적용 ${applied}, 건너뜀 ${skipped}). 현재 PDF 페이지 미리보기 갱신.`;
      setApplyMsg(msg);
      setLastPreviewMsg(msg);
      if (selectedMeasure) {
        setScrollToMeasureTrigger((n) => n + 1);
      }
    } catch (e) {
      setApplyMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyBusy(false);
    }
  }, [jobId, persistFixes, refreshScoreXml, loadFixesFromServer, selectedMeasure, pageMeasureRange]);

  const openMeasure = useCallback(
    (info: OsmdMeasureClickInfo) => {
      setSelectedMeasure(info);
      setManualMeasureMxl(String(info.measureMxl));
      const partId = resolvePartIdForMeasure(info);
      const fromPreviewId = info.partId?.trim()
        ? resolveMusicXmlPartFromPreviewId(info.partId)
        : null;
      const staffWithin =
        fromPreviewId?.staffWithinPart ?? info.staffWithinPart ?? null;
      const staffLabel =
        labelForPartStaff(partId, staffWithin) ??
        staffList[info.staffIndex] ??
        `줄 ${info.staffIndex + 1}`;
      setMeasureClickMsg(
        `마디 선택됨 · m.${info.measureMxl} · ${staffLabel}`,
      );
      if (!staffFilter) {
        setEditPartId(partId);
      }
      setEditorKey((k) => k + 1);
    },
    [staffFilter, resolvePartIdForMeasure, labelForPartStaff, staffList],
  );

  const openManualMeasure = useCallback(() => {
    const measureMxl = parseInt(manualMeasureMxl.trim(), 10);
    if (!Number.isFinite(measureMxl) || measureMxl < 1) return;
    const staffIndex = staffFilter
      ? Math.max(0, staffList.indexOf(staffFilter))
      : 0;
    const pdfPage = inferPdfPageForMxlMeasure(pageMeasureIndex, measureMxl);
    if (pdfPage !== page) {
      startPageTransition(() => setPage(Math.max(1, Math.min(pageCount, pdfPage))));
    }
    openMeasure({
      measureMxl,
      staffIndex,
      partId: staffFilter ? partIdForStaff(staffFilter) : null,
      staffWithinPart: staffFilter ? staffWithinPartForLabel(staffFilter) ?? undefined : undefined,
    });
    if (!staffFilter && !editPartId) {
      setEditPartId(resolvePartIdForStaffIndex(staffIndex));
    }
    setMeasureClickMsg(
      `마디 이동 · m.${measureMxl} → PDF p.${pdfPage} (구간 m.${measureRangeFromPageIndex(pageMeasureIndex, pdfPage).start}–${measureRangeFromPageIndex(pageMeasureIndex, pdfPage).end})`,
    );
  }, [
    manualMeasureMxl,
    staffFilter,
    staffList,
    openMeasure,
    editPartId,
    partIdForStaff,
    staffWithinPartForLabel,
    resolvePartIdForStaffIndex,
    pageMeasureIndex,
    page,
    pageCount,
  ]);

  const stepMeasure = useCallback(
    (delta: number) => {
      const parsed = parseInt(manualMeasureMxl.trim(), 10);
      const cur =
        selectedMeasure?.measureMxl ??
        (Number.isFinite(parsed) && parsed >= 1 ? parsed : pageMeasureRange.start);
      const next = Math.max(1, Math.min(pageMeasureIndex.maxMeasure, cur + delta));
      setManualMeasureMxl(String(next));
      const staffIndex = staffFilter ? Math.max(0, staffList.indexOf(staffFilter)) : 0;
      const pdfPage = inferPdfPageForMxlMeasure(pageMeasureIndex, next);
      if (pdfPage !== page) {
        startPageTransition(() => setPage(Math.max(1, Math.min(pageCount, pdfPage))));
      }
      openMeasure({
        measureMxl: next,
        staffIndex,
        partId: staffFilter ? partIdForStaff(staffFilter) : null,
        staffWithinPart: staffFilter ? staffWithinPartForLabel(staffFilter) ?? undefined : undefined,
      });
    },
    [
      selectedMeasure,
      manualMeasureMxl,
      pageMeasureRange.start,
      pageMeasureIndex,
      staffFilter,
      staffList,
      page,
      pageCount,
      openMeasure,
      partIdForStaff,
      staffWithinPartForLabel,
    ],
  );

  /** 거리 드롭다운은 OSMD 재로드 없이 pending extraY만 적용. Accent는 음표에 남겨 VexFlow가 오선 옆에 그림(mf Direction과 섞지 않음). */
  const previewXml = useMemo(() => {
    if (!rawXml || !scoreParts.length) return '';
    if (imagePdfLight) {
      // 이미지 PDF: 전체/페이지 OSMD 금지 — 성부 + 선택 마디 1개만.
      if (!activeStaffFilter || !selectedMeasure) return '';
      const m = selectedMeasure.measureMxl;
      const measureScoped = filterMusicXmlToMeasureRange(rawXml, m, m);
      return buildOsmdPreviewXml(measureScoped, scoreParts, activeStaffFilter, {
        verbatim: true,
        faithfulEditorLayout: true,
      });
    }
    const pageScoped = filterMusicXmlToMeasureRange(
      rawXml,
      deferredPageMeasureRange.start,
      deferredPageMeasureRange.end,
    );
    return buildOsmdPreviewXml(pageScoped, scoreParts, activeStaffFilter, {
      verbatim: true,
      faithfulEditorLayout: true,
    });
  }, [
    rawXml,
    scoreParts,
    activeStaffFilter,
    deferredPageMeasureRange,
    imagePdfLight,
    selectedMeasure,
  ]);

  const osmdPreviewKey = imagePdfLight
    ? `osmd-light-m${selectedMeasure?.measureMxl ?? 0}-${staffFilter || 'none'}`
    : `osmd-preview-p${deferredPage}-${staffFilter || 'all'}`;

  /** MXL 반영분(artPreviewFixes) + 대기분 — 대기가 같은 음표를 덮어씀 */
  const osmdArticulationFixes = useMemo(
    () => mergeArticulationPreviewFixes(artPreviewFixes, pendingFixes.filter(isOsmdPreviewFix)),
    [artPreviewFixes, pendingFixes],
  );

  const artPreviewStatus = useMemo(() => {
    const arts = osmdArticulationFixes;
    const dy = extraYPxFromArticulationFixes(arts, 10);
    const dists = arts
      .map((f) => f.distance || 'auto')
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(',');
    return { count: arts.length, dy, dists };
  }, [osmdArticulationFixes]);

  const activePartLabels = staffList.length
    ? staffList
    : scoreParts.map((p) => p.displayLabel || p.suggestedLabel).filter(Boolean);

  return (
    <div className="modal-light" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: 0 }}>
      <div>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          OMR 품질 검토 (페이지×성부)
          {summary?.activeOmrEngine && (
            <span style={{
              fontSize: '0.75rem',
              background: '#2563eb',
              color: 'white',
              padding: '2px 6px',
              borderRadius: '12px',
              fontWeight: 500
            }}>
              'Audiveris'
            </span>
          )}
        </h2>
        <p style={{ margin: 0, lineHeight: 1.55, fontSize: '0.92rem' }}>
          PDF와 MusicXML을 나란히 대조하세요. 오른쪽 악보에서 <strong>마디를 클릭</strong>해 쉼표·음표·점 등을
          조정하고, 「MXL에 반영·미리보기」로 오른쪽 악보에서 확인한 뒤 「이어하기」로
          최종 MXL에 반영됩니다(MuseScore 불필요). 성부(
          {activePartLabels.length > 0 ? (
            <strong>{activePartLabels.join(' / ')}</strong>
          ) : (
            <strong>S/A/T/B/M/W/U/PR/PL</strong>
          )}
          ). HITL·편집·음자리표 범위는 MusicXML <code>measure@number</code>(전곡 마디 번호)로 통일합니다.
          {' '}
          <span style={{ color: '#555' }}>
            저장 MXL은 Audiveris raw(+ HITL 보정) 그대로입니다. 미리보기만 m1 조표·조바꿈 F clef 오인·줄바꿈
            courtesy clef·<strong>줄머리 마디 번호</strong>는 MusicXML <code>measure@number</code>로 표시합니다(OSMD 자동 번호·Audiveris OCR 숫자 words는 끔).{' '}
            <strong>1마디</strong>를 클릭하면(제목·찌끼 영역 포함) 「마디 텍스트 (제목·OCR 찌끼)」에서 direction을 삭제·수정할 수 있습니다.
            제목은 보통 <strong>첫 번째 파트(P1)</strong> m1에만 있습니다.
            마디 끝 phantom clef·최종 MXL measure-numbering은 「OMR 자동 정리」 또는 이어하기 후 반영. PDF 줄머리 인쇄 번호와 MXL이 다를 수 있으나, 편집 UI는 MXL 번호만 사용합니다.
          </span>
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
        <button type="button" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
          ◀
        </button>
        <span style={{ fontWeight: 600 }}>
          {page} / {pageCount}
          {pagePending || deferredPage !== page ? (
            <span style={{ marginLeft: 6, fontSize: '0.8rem', color: '#666', fontWeight: 500 }}>
              미리보기 갱신 중…
            </span>
          ) : null}
        </span>
        <button
          type="button"
          disabled={page >= pageCount}
          onClick={() => goToPage(page + 1)}
        >
          ▶
        </button>
        <span style={{ marginLeft: '0.75rem', fontSize: '0.9rem', fontWeight: 600 }}>성부 필터</span>
        {!imagePdfLight ? (
          <button
            type="button"
            className={staffFilter === '' ? '' : 'btn-muted'}
            onClick={() => setStaffFilter('')}
          >
            전체
          </button>
        ) : null}
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
        {imagePdfLight ? (
          <span style={{ fontSize: '0.82rem', color: '#555', maxWidth: '28rem', lineHeight: 1.4 }}>
            이미지 PDF 경량 모드 · PNG {pngDpi} DPI(긴 변≤{PNG_MAX_SIDE_IMAGE_LIGHT}px) · OSMD는{' '}
            <strong>선택 마디 1개</strong>만 · 페이지/마디 번호로 이동
            (이 페이지 m.{pageMeasureRange.start}–{pageMeasureRange.end})
          </span>
        ) : null}
      </div>

      <div className="omr-compare-row">
        <div className="omr-compare-col">
          <div style={{ fontSize: '0.88rem', marginBottom: 6, fontWeight: 600, color: '#333' }}>
            PDF ({pngSource === 'clean_score' ? 'clean_score' : '원본'}) · p.{page} · {pngDpi} DPI
          </div>
          <div className="omr-pdf-frame">
            <DiagnosticPagePng
              jobId={jobId}
              page={page}
              source={pngSource}
              dpi={pngDpi}
              maxSide={pngMaxSide}
            />
          </div>
        </div>
        <div className="omr-compare-col omr-compare-col--mxl">
          <div className="omr-mxl-preview-head">
            <span style={{ fontSize: '0.88rem', fontWeight: 600, color: '#333' }}>
              MusicXML (OMR MXL)
              {activeStaffFilter ? ` · ${activeStaffFilter.label}` : staffFilter ? ` · ${staffFilter}` : ' · 전체 파트'}
            </span>
            <div
              data-hitl-art-status="1"
              style={{
                fontSize: 12,
                fontFamily: 'ui-monospace, Consolas, monospace',
                padding: '3px 8px',
                borderRadius: 4,
                background: artPreviewStatus.dy !== 0 ? '#0b7285' : artPreviewStatus.count ? '#868e96' : '#e9ecef',
                color: artPreviewStatus.count || artPreviewStatus.dy ? '#fff' : '#495057',
                fontWeight: 600,
              }}
              title="Accent 거리 — 대기 보정 + MXL 반영분(artPreviewFixes) → OSMD Δ. 반영 후에도 유지."
            >
              {artPreviewStatus.count === 0
                ? 'Accent 거리: 대기/반영 없음'
                : `Accent ${artPreviewStatus.dists || '?'}칸 · Δ=${artPreviewStatus.dy}px (1칸 대비)`}
            </div>
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
                <div className="omr-mxl-osmd-placeholder omr-mxl-osmd-err" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                  <p style={{ margin: 0, userSelect: 'text' }}>{xmlLoadErr}</p>
                  <button type="button" className="btn-muted" onClick={() => navigator.clipboard.writeText(xmlLoadErr)}>
                    에러 복사
                  </button>
                </div>
              ) : previewXml ? (
                <OsmdBlock
                  key={osmdPreviewKey}
                  xml={previewXml}
                  articulationHintXml={previewXml}
                  articulationFixes={osmdArticulationFixes}
                  zoom={scoreZoom}
                  embeddedInOmrFrame
                  verbatimPreview
                  faithfulEditorLayout
                  previewMeasureRange={
                    imagePdfLight && selectedMeasure
                      ? { start: selectedMeasure.measureMxl, end: selectedMeasure.measureMxl }
                      : deferredPageMeasureRange
                  }
                  onMeasureClick={openMeasure}
                  highlightMeasureMxl={selectedMeasure?.measureMxl ?? null}
                  highlightMeasureStaffIndex={selectedMeasure?.staffIndex ?? null}
                  scrollToMeasure={selectedMeasure ?? (imagePdfLight ? null : pageScrollTarget)}
                  scrollToMeasureTrigger={scrollToMeasureTrigger}
                />
              ) : imagePdfLight ? (
                <p className="omr-mxl-osmd-placeholder" style={{ lineHeight: 1.55, padding: '1rem' }}>
                  <strong>이미지 PDF 경량 미리보기</strong>
                  <br />
                  페이지 넘김은 PDF만 바꿉니다. OSMD는 메모리 부담을 줄이려{' '}
                  <strong>성부 + 마디 1개</strong>만 그립니다.
                  <br />
                  아래 「마디 번호로 열기」에 이 페이지 구간(m.{pageMeasureRange.start}–
                  {pageMeasureRange.end}) 번호를 넣고 열거나, 편집할 마디를 지정하세요.
                </p>
              ) : (
                <p className="omr-mxl-osmd-placeholder">표시할 MusicXML이 없습니다.</p>
              )}
            </InspectPanelErrorBoundary>
          </div>
          <p className="omr-mxl-preview-hint">
            {imagePdfLight ? (
              <>
                이미지 PDF는 <strong>선택 마디만</strong> OSMD로 그립니다. 페이지 ◀▶ 는 PNG만 바꾸고,
                <strong> 마디 번호 / ◀마디 / 마디▶</strong> 로 PDF 페이지까지 같이 이동합니다
                (DPI {pngDpi}, 긴 변≤{PNG_MAX_SIDE_IMAGE_LIGHT}px).
              </>
            ) : (
              <>
                <strong>오선·음표</strong> 위에 마우스를 올리면 마디가 하늘색으로 표시되고, 클릭하면 편집 패널이 열립니다.
                {staffFilter === '' ? ' 전체 파트 보기에서는 클릭한 줄의 성부가 자동 선택됩니다.' : ''}
                {' '}
                <span style={{ color: '#666' }}>
                  미리보기는 PDF {page}페이지 구간(MXL m.{pageMeasureRange.start}–{pageMeasureRange.end})만 OSMD로 그립니다.
                  다른 페이지·전체 악보는 페이지 이동 또는 「MXL 새로고침」으로 확인하세요.
                </span>
              </>
            )}
          </p>
          {measureClickMsg ? (
            <p className="omr-mxl-preview-hint" style={{ color: '#1565c0', fontWeight: 600 }}>
              {measureClickMsg}
            </p>
          ) : null}
          <div className="omr-manual-measure-open">
            <label>
              {imagePdfLight ? '마디 번호로 이동·미리보기' : '마디 번호로 열기(보조)'}
              <input
                type="number"
                min={1}
                max={pageMeasureIndex.maxMeasure}
                value={manualMeasureMxl}
                onChange={(e) => setManualMeasureMxl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    openManualMeasure();
                  }
                }}
                placeholder="MXL 마디"
                style={{ width: 72, marginLeft: 6 }}
              />
            </label>
            <button type="button" className={imagePdfLight ? '' : 'btn-muted'} onClick={() => openManualMeasure()}>
              {imagePdfLight ? '마디로 이동' : '마디 편집 열기'}
            </button>
            <button
              type="button"
              className="btn-muted"
              disabled={(selectedMeasure?.measureMxl ?? parseInt(manualMeasureMxl, 10) ?? 1) <= 1}
              onClick={() => stepMeasure(-1)}
              title="이전 마디 (PDF 페이지 자동 동기)"
            >
              ◀ 마디
            </button>
            <button
              type="button"
              className="btn-muted"
              disabled={
                (selectedMeasure?.measureMxl ?? parseInt(manualMeasureMxl, 10) ?? 1) >=
                pageMeasureIndex.maxMeasure
              }
              onClick={() => stepMeasure(1)}
              title="다음 마디 (PDF 페이지 자동 동기)"
            >
              마디 ▶
            </button>
            {imagePdfLight ? (
              <button
                type="button"
                className="btn-muted"
                onClick={() => {
                  setManualMeasureMxl(String(pageMeasureRange.start));
                  const staffIndex = staffFilter ? Math.max(0, staffList.indexOf(staffFilter)) : 0;
                  openMeasure({
                    measureMxl: pageMeasureRange.start,
                    staffIndex,
                    partId: staffFilter ? partIdForStaff(staffFilter) : null,
                    staffWithinPart: staffFilter
                      ? staffWithinPartForLabel(staffFilter) ?? undefined
                      : undefined,
                  });
                }}
              >
                이 페이지 첫 마디(m.{pageMeasureRange.start})
              </button>
            ) : null}
            <button
              type="button"
              className="btn-muted"
              onClick={() => {
                const staffIndex = staffFilter ? Math.max(0, staffList.indexOf(staffFilter)) : 0;
                setManualMeasureMxl('1');
                if (page !== 1) startPageTransition(() => setPage(1));
                openMeasure({
                  measureMxl: 1,
                  staffIndex,
                  partId: staffFilter ? partIdForStaff(staffFilter) : null,
                  staffWithinPart: staffFilter ? staffWithinPartForLabel(staffFilter) ?? undefined : undefined,
                });
              }}
            >
              1마디 제목·찌끼
            </button>
          </div>
        </div>
      </div>

      {selectedMeasure ? (
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
                    {p.displayLabel || p.suggestedLabel || p.id} (part {p.id})
                  </option>
                ))}
              </select>
              <span className="omr-measure-part-picker-hint">
                (클릭한 줄:{' '}
                {labelForPartStaff(
                  resolvePartIdForMeasure(selectedMeasure),
                  selectedMeasure.staffWithinPart,
                ) ??
                  staffList[selectedMeasure.staffIndex] ??
                  `줄 ${selectedMeasure.staffIndex + 1}`}
                )
              </span>
            </label>
          )}
          {editorPartId ? (
            <InspectPanelErrorBoundary>
              <OmrMeasureEditor
                key={`${editorPartId}-${selectedMeasure.measureMxl}-${previewRevision}`}
                jobId={jobId}
                partId={editorPartId}
                measureMxl={selectedMeasure.measureMxl}
                staffLabel={
                  (selectedMeasure
                    ? labelForPartStaff(editorPartId, editStaffWithinPart ?? selectedMeasure.staffWithinPart)
                    : null) ||
                  staffFilter ||
                  scoreParts.find((p) => p.id === editorPartId)?.displayLabel ||
                  scoreParts.find((p) => p.id === editorPartId)?.suggestedLabel ||
                  undefined
                }
                editStaffWithinPart={editStaffWithinPart}
                partStaveCount={rawXml ? staveCountForPart(rawXml, editorPartId) : 1}
                previewRevision={previewRevision}
                lastPreviewMsg={lastPreviewMsg}
                pendingFixCount={pendingFixes.length}
                pendingFixes={pendingFixes}
                previewBusy={applyBusy}
                availableScoreParts={scoreParts}
                onPreview={() => void applyFixesToMxl()}
                onAddFix={addFix}
              />
            </InspectPanelErrorBoundary>
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
        <p className="omr-hitl-panel-hint" style={{ margin: '0.35rem 0 0', fontSize: '0.88rem', color: '#555' }}>
          <strong>「MXL에 반영·미리보기」</strong> 후 반영된 보정은 대기 목록에서 자동으로 제거됩니다(누적 재적용 방지). 이후 수정은 새로 추가한 보정만 다시 반영하면 됩니다.
        </p>
        <div className="omr-hitl-panel-title">대기 중인 MXL 보정 ({pendingFixes.length}건)</div>
        <p className="omr-hitl-panel-hint">
          마디 편집에서 추가한 보정이 여기 쌓입니다. <strong>「MXL에 반영·미리보기」</strong>로 OMR MXL을
          갱신하고 오른쪽 악보에서 확인하세요. 반영이 끝난 보정은 목록에서 비워지며, 다음 보정만 다시 쌓으면 됩니다.
          패널을 열면 저장된 baseline과 대기 보정을 자동 동기화합니다.
          중단 후 이어하려면 <strong>「작업 저장(ZIP)」</strong> → 같은 job에서 <strong>「작업 불러오기」</strong>.
          서버·브라우저를 닫았다면 변환 화면에서 <strong>「OMR 검토 이어하기」</strong> + ZIP으로 새 변환을 시작하세요.
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
            title="쉼표·조표·음자리표(courtesy)·피아노 timeline 등 OMR 오류를 전체 성부에서 한 번에 정리합니다. 마디 편집으로 고칠 수 없는 줄끝 phantom clef도 여기서 처리됩니다."
          >
            {applyBusy ? '정리 중…' : 'OMR 자동 정리 (전체 성부)'}
          </button>
          <button
            type="button"
            className="btn-muted"
            disabled={applyBusy || exportBusy}
            onClick={() => void exportWork()}
            title={exportBusy ? `저장 중… ${exportPercent}%` : '검토 진행 ZIP 저장'}
          >
            {exportBusy ? `저장 중… ${exportPercent}%` : '작업 저장(ZIP)'}
          </button>
          <button
            type="button"
            className="btn-muted"
            disabled={applyBusy}
            onClick={() => setRangeImportOpen((v) => !v)}
            title="새로 인식한 MXL 위에, 저장해 둔 omr-work ZIP의 특정 마디 구간(전 파트)만 덮어씁니다"
          >
            {rangeImportOpen ? '마디 구간 가져오기 닫기' : '마디 구간 가져오기'}
          </button>
          <button
            type="button"
            className="btn-muted"
            disabled={applyBusy}
            onClick={() => importWorkInputRef.current?.click()}
          >
            작업 불러오기
          </button>
          <input
            ref={importWorkInputRef}
            type="file"
            accept=".zip,application/zip"
            disabled={applyBusy}
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void importWork(f);
            }}
          />
          <input
            ref={importRangeInputRef}
            type="file"
            accept=".zip,application/zip"
            disabled={applyBusy}
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void importMeasureRange(f);
            }}
          />
        </div>
        {rangeImportOpen ? (
          <div
            style={{
              marginTop: 8,
              padding: '10px 12px',
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              fontSize: '0.86rem',
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              이전 omr-work ZIP에서 마디 구간 가져오기 (전 파트)
            </div>
            <p style={{ margin: '0 0 8px', color: '#475569', lineHeight: 1.45 }}>
              Audiveris를 <strong>다시 돌린 뒤</strong>에도, 예전에 편집해 저장한 ZIP의{' '}
              <strong>지정 마디 구간</strong>을 현재 MXL에 그대로 덮어씁니다. S·A·T·B·P 등{' '}
              <strong>모든 파트</strong>가 한 번에 복사됩니다. 출처는 서버가{' '}
              <strong>「작업 불러오기」와 같은 import-work + sync</strong> 파이프라인으로 만든 MXL에서
              가져옵니다 (ZIP을 Python만으로 재해석하지 않음).
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span>출처 마디</span>
                <input
                  type="number"
                  min={1}
                  value={rangeImportStart}
                  onChange={(e) => setRangeImportStart(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  style={{ width: 52, padding: '2px 4px' }}
                />
                <span>~</span>
                <input
                  type="number"
                  min={1}
                  value={rangeImportEnd}
                  onChange={(e) => setRangeImportEnd(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  style={{ width: 52, padding: '2px 4px' }}
                />
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span>대상 시작 마디</span>
                <input
                  type="number"
                  min={1}
                  placeholder={String(rangeImportStart)}
                  value={rangeImportTargetStart}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    setRangeImportTargetStart(v === '' ? '' : Math.max(1, parseInt(v, 10) || 1));
                  }}
                  style={{ width: 52, padding: '2px 4px' }}
                />
                <span style={{ color: '#64748b', fontSize: '0.8rem' }}>(비우면 출처와 동일)</span>
              </label>
              <button
                type="button"
                className="btn-muted"
                disabled={applyBusy}
                onClick={() => importRangeInputRef.current?.click()}
              >
                omr-work ZIP 선택 후 가져오기
              </button>
            </div>
          </div>
        ) : null}
        {workMsg ? <p className="omr-hitl-apply-msg">{workMsg}</p> : null}
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
