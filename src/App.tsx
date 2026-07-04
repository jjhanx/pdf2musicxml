import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FontStripPanel } from './FontStripPanel';
import { CleanScorePreviewPanel } from './CleanScorePreviewPanel';
import { AudiverisInspectPanel, InspectPanelErrorBoundary } from './AudiverisInspectPanel';
import { OmrStaffReviewPanel } from './OmrStaffReviewPanel';
import { PartLabelsPanel } from './PartLabelsPanel';
import { defaultPartLabels } from './partLabelOptions';
import { ManualLyricMaskPanel, type ManualLyricBBox } from './ManualLyricMaskPanel';

type Health = {
  ok: boolean;
  audiverisConfigured?: boolean;
  audiverisLegacyEngine?: boolean;
  omrEngine?: string;
  omrEngineReady?: boolean;
  omrEngineDetail?: string;
  pdftomusicConfigured?: boolean;
  pdftomusicBin?: string;
  pdftomusicDepsHint?: string;
  aiOmrBackend?: string;
  aiOmrDepsOk?: boolean;
  aiOmrTorchOk?: boolean;
  aiOmrCudaAvailable?: boolean;
  aiOmrMissingModules?: string[];
  aiOmrDepsHint?: string;
  audiverisPauseOnWarn?: boolean;
  audiverisWarnPattern?: string | null;
  fontSeparatorDepsOk?: boolean;
  fontSeparatorPythonBin?: string;
  fontSeparatorProbeExecutable?: string;
  fontSeparatorProbeError?: string;
  fontSeparatorMissingModules?: string[];
  fontSeparatorDepsHint?: string;
  hint?: string;
  jobRetentionHours?: number;
  jobRetentionNote?: string;
};

type TaskProgress = {
  phase: string;
  current: number;
  total: number;
  detail?: string;
};

type ConvertTask = {
  id: string;
  fileName: string;
  phase: 'queued' | 'running' | 'done' | 'error';
  /** 완료 후 마스킹·인식 점검 API용(24h TTL 전까지) */
  jobId?: string;
  downloadUrl?: string;
  downloadName?: string;
  errorMessage?: string;
  progress?: TaskProgress;
};

type PipelineMode = 'audiveris_only' | 'pymupdf_review' | 'font_separator';

/** 같은 PDF 반복 작업 시 중간 단계부터 시작 */
type StartStage = 'full' | 'lyric_review' | 'omr' | 'omr_hitl' | 'lyric_review_only';

type OcrReviewItem = {
  id: string;
  page: number;
  text: string;
  confidence: number;
  x: number;
  y: number;
  bbox?: number[];
  /** 벡터 추출 시 줄 단위 블록을 이루는 PyMuPDF span 들의 텍스트·bbox(마스킹 시 추출 좌표 우선) */
  spans?: { text: string; bbox: number[] }[];
  type?: string;
  /** MusicXML에서 `part` 순서(1=첫 파트, 합창 4부면 보통 4). Audiveris 출력 part-list 순서와 동일 */
  lyricPartIndex?: number;
  /** 같은 파트·같은 멜로디에 1절·2절 등 → MusicXML `<lyric number>` (1부터). 멜로디 줄(voice)과 별개 */
  lyricVerseIndex?: number;
  /** 해당 파트 안의 MusicXML `<voice>` — 동시에 울리는 **서로 다른 멜로디 줄**(1절/2절이 아님). 미입력 시 1 */
  lyricVoice?: string;
  /** 이 블록의 가사를 넣기 전, 해당 성부에서 건너뛸 선율 음표 수(박·도입 등) */
  lyricSkipNotes?: number;
};

function mergeReviewFieldsFromSaved(
  item: OcrReviewItem,
  match: Record<string, unknown>,
): OcrReviewItem {
  const next = { ...item };
  if (typeof match.type === 'string') next.type = match.type;
  if (typeof match.text === 'string') next.text = match.text;
  if (typeof match.lyricPartIndex === 'number' && match.lyricPartIndex >= 1) {
    next.lyricPartIndex = Math.floor(match.lyricPartIndex);
  }
  if (typeof match.lyricVerseIndex === 'number' && match.lyricVerseIndex >= 1) {
    next.lyricVerseIndex = Math.floor(match.lyricVerseIndex);
  }
  if (typeof match.lyricVoice === 'string') next.lyricVoice = match.lyricVoice;
  if (typeof match.lyricSkipNotes === 'number' && match.lyricSkipNotes >= 0) {
    next.lyricSkipNotes = Math.floor(match.lyricSkipNotes);
  }
  const mb = match.bbox;
  if (Array.isArray(mb) && mb.length >= 4) {
    const nums = mb.map((x) => Number(x));
    if (nums.every((x) => Number.isFinite(x))) {
      next.bbox = nums;
    }
  }
  const msp = match.spans;
  if (Array.isArray(msp)) {
    const spans: { text: string; bbox: number[] }[] = [];
    for (const s of msp) {
      if (!s || typeof s !== 'object') continue;
      const o = s as { text?: unknown; bbox?: unknown };
      if (typeof o.text !== 'string') continue;
      const bb = o.bbox;
      if (!Array.isArray(bb) || bb.length < 4) continue;
      const bbn = bb.map((x) => Number(x));
      if (!bbn.every((x) => Number.isFinite(x))) continue;
      spans.push({ text: o.text, bbox: bbn });
    }
    if (spans.length > 0) next.spans = spans;
  }
  return next;
}

const LYRIC_VOICE_PRESETS = ['1', '2', '3', '4', '*'] as const;

function lyricVoicePresetKey(v: string | undefined): (typeof LYRIC_VOICE_PRESETS)[number] | '__custom__' {
  const s = (v && String(v).trim()) || '1';
  return (LYRIC_VOICE_PRESETS as readonly string[]).includes(s)
    ? (s as (typeof LYRIC_VOICE_PRESETS)[number])
    : '__custom__';
}

/** 검토 임시저장(JSON)·백업 v2 본문 */
type StoredReviewDraftV2 = {
  v: 2;
  items: OcrReviewItem[];
  manualLyricRects: ManualLyricBBox[];
};

const MANUAL_LYRIC_MASK_TYPE = '_manual_lyric_mask';
const MANUAL_LYRIC_MASK_ID = '__manual_lyric_regions__';

function parseManualRectsFromUnknown(zones: unknown): ManualLyricBBox[] {
  if (!Array.isArray(zones)) return [];
  const out: ManualLyricBBox[] = [];
  for (const z of zones) {
    if (!z || typeof z !== 'object') continue;
    const page = Number((z as { page?: unknown }).page);
    const bb = (z as { bbox?: unknown }).bbox;
    if (!Number.isFinite(page) || page < 1 || !Array.isArray(bb) || bb.length < 4) continue;
    const n0 = Number(bb[0]);
    const n1 = Number(bb[1]);
    const n2 = Number(bb[2]);
    const n3 = Number(bb[3]);
    if (![n0, n1, n2, n3].every((x) => Number.isFinite(x))) continue;
    out.push({ page: Math.floor(page), bbox: [n0, n1, n2, n3] });
  }
  return out;
}

/**
 * 서버 또는 백업에서 온 배열에서 UI용 OCR 행과 수동 마스크 좌표를 분리합니다.
 */
function partitionReviewPayload(rows: unknown[]): {
  items: OcrReviewItem[];
  manualLyricRects: ManualLyricBBox[];
} {
  const items: OcrReviewItem[] = [];
  const manualLyricRects: ManualLyricBBox[] = [];
  for (const raw of rows) {
    const it = raw as Record<string, unknown>;
    if (it.type === MANUAL_LYRIC_MASK_TYPE) {
      manualLyricRects.push(...parseManualRectsFromUnknown(it.manualRects));
      continue;
    }
    items.push(raw as OcrReviewItem);
  }
  return { items, manualLyricRects };
}

function loadReviewDraftFromLocalStorageJson(rawJson: unknown): {
  items: unknown[];
  manualLyricRects: ManualLyricBBox[];
} {
  const r = rawJson;
  if (r && typeof r === 'object' && (r as { v?: number }).v === 2 && Array.isArray((r as StoredReviewDraftV2).items)) {
    const d = r as StoredReviewDraftV2;
    return {
      items: d.items as unknown[],
      manualLyricRects: parseManualRectsFromUnknown(d.manualLyricRects),
    };
  }
  if (
    r &&
    typeof r === 'object' &&
    (r as { v?: number }).v === 3 &&
    Array.isArray((r as { items?: unknown[] }).items)
  ) {
    const d = r as { items: unknown[]; manualLyricRects?: unknown };
    return {
      items: d.items as unknown[],
      manualLyricRects: parseManualRectsFromUnknown(d.manualLyricRects),
    };
  }
  if (Array.isArray(r)) {
    const { items, manualLyricRects } = partitionReviewPayload(r);
    return { items: items as unknown[], manualLyricRects };
  }
  return { items: [], manualLyricRects: [] };
}

/** 추출 JSON은 type이 unknown인 경우가 많아, 검토 창 첫 표시 시 기본은 가사로 둔다. */
function defaultReviewTypeForInit(t: string | undefined): string {
  if (
    t === 'title' ||
    t === 'composer' ||
    t === 'lyricist' ||
    t === 'copyright' ||
    t === 'lyrics' ||
    t === 'tempo'
  ) {
    return t;
  }
  return 'lyrics';
}

function isPdfFile(f: File): boolean {
  const byName = /\.pdf$/i.test(f.name);
  const byType =
    f.type === 'application/pdf' ||
    f.type === 'application/x-pdf' ||
    (f.type === 'application/octet-stream' && byName);
  return byType || byName;
}

function extractPdfFilesFromDataTransfer(dt: DataTransfer): File[] {
  const out: File[] = [];
  const seen = new Set<string>();

  const take = (f: File | null) => {
    if (!f || !isPdfFile(f)) return;
    const k = taskKey(f);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(f);
  };

  if (dt.files?.length) {
    for (let i = 0; i < dt.files.length; i++) take(dt.files[i]);
  }
  if (!out.length && dt.items?.length) {
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (item.kind === 'file') take(item.getAsFile());
    }
  }
  return out;
}

function taskKey(f: File): string {
  return `${f.name}|${f.size}|${f.lastModified}`;
}

function mergePdfFiles(existing: File[], incoming: File[]): File[] {
  const keys = new Set(existing.map(taskKey));
  const out = [...existing];
  for (const f of incoming) {
    if (!isPdfFile(f)) continue;
    const k = taskKey(f);
    if (keys.has(k)) continue;
    keys.add(k);
    out.push(f);
  }
  return out;
}

function revokeTaskUrls(tasks: ConvertTask[]) {
  for (const t of tasks) {
    const u = t.downloadUrl;
    if (u?.startsWith('blob:')) URL.revokeObjectURL(u);
  }
}

const POLL_INTERVAL_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function taskProgressPhaseLabel(phase: string): string {
  if (phase === 'upload') return 'PDF 업로드';
  if (phase === 'separator') return '가사·악보 분리';
  if (phase === 'audiveris') return '악보 인식(OMR)';
  if (phase === 'hitl') return '악보 교정(HITL)';
  return phase;
}

/** 서버가 progress를 안 줄 때(대기 UI) status만으로 표시 */
function taskProgressFromJobStatus(status: string): TaskProgress | undefined {
  switch (status) {
    case 'font_strip_needed':
      return { phase: 'separator', current: 0, total: 0, detail: '폰트 크기 선택 대기…' };
    case 'clean_score_preview_needed':
      return { phase: 'separator', current: 0, total: 0, detail: 'clean_score PDF 확인 대기…' };
    case 'review_needed':
      return { phase: 'separator', current: 0, total: 0, detail: '가사 검증·편집 대기…' };
    case 'part_labels_needed':
      return { phase: 'hitl', current: 0, total: 0, detail: '성부 라벨(S/A/T/B) 확인 대기…' };
    case 'omr_staff_review_needed':
      return { phase: 'hitl', current: 0, total: 0, detail: 'OMR 품질 검토 — PDF·MXL 대조·마디 편집 대기…' };
    case 'audiveris_review_needed':
      return { phase: 'hitl', current: 0, total: 0, detail: 'Audiveris 결과 보정 대기…' };
    default:
      return undefined;
  }
}

function formatTaskProgressLine(p: TaskProgress): string {
  const phase = taskProgressPhaseLabel(p.phase);
  const frac = p.total > 0 ? `${p.current} / ${p.total}` : '';
  const parts: string[] = [phase];
  if (frac) parts.push(`(${frac})`);
  if (p.detail) parts.push(p.detail);
  return parts.join(' ');
}

function newTaskId(): string {
  try {
    const c = globalThis.crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    /* skip */
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [tasks, setTasks] = useState<ConvertTask[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [autoSave, setAutoSave] = useState(false);
  
  const [reviewingJobId, setReviewingJobId] = useState<string | null>(null);
  const [reviewData, setReviewData] = useState<OcrReviewItem[]>([]);
  const [manualLyricRects, setManualLyricRects] = useState<ManualLyricBBox[]>([]);
  /** 미리보기와 연동되는 검토 줄 인덱스 */
  const [focusedReviewRowIndex, setFocusedReviewRowIndex] = useState<number | null>(null);
  const reviewRowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [reviewOriginalFileName, setReviewOriginalFileName] = useState('');
  const [hasSavedData, setHasSavedData] = useState(false);
  const [pauseAfterAudiveris, setPauseAfterAudiveris] = useState(false);
  const [pipelineMode, setPipelineMode] = useState<PipelineMode>('font_separator');
  const [enablePymupdfReview, setEnablePymupdfReview] = useState(true);
  const [enableOmrStaffReview, setEnableOmrStaffReview] = useState(true);
  const [startStage, setStartStage] = useState<StartStage>(() => {
    try {
      const v = localStorage.getItem('pdf2mxl_start_stage');
      if (v === 'lyric_review' || v === 'omr' || v === 'omr_hitl') return v;
    } catch {
      /* ignore */
    }
    return 'full';
  });
  const [resumeCleanScoreFile, setResumeCleanScoreFile] = useState<File | null>(null);
  const [resumeLyricManifestFile, setResumeLyricManifestFile] = useState<File | null>(null);
  const [resumeOmrWorkFile, setResumeOmrWorkFile] = useState<File | null>(null);
  const [resumeCorrectedMxlFile, setResumeCorrectedMxlFile] = useState<File | null>(null);
  const [fontStripJobId, setFontStripJobId] = useState<string | null>(null);
  const [cleanScorePreviewJobId, setCleanScorePreviewJobId] = useState<string | null>(null);
  const [partLabelsJobId, setPartLabelsJobId] = useState<string | null>(null);
  const [partLabelCount, setPartLabelCount] = useState(6);
  const [partLabelsPreset, setPartLabelsPreset] = useState<string[]>(() => defaultPartLabels(6));
  const [omrStaffReviewJobId, setOmrStaffReviewJobId] = useState<string | null>(null);
  const [omrStaffContinueBusy, setOmrStaffContinueBusy] = useState(false);
  const [audiverisReviewJobId, setAudiverisReviewJobId] = useState<string | null>(null);
  const [audiverisModalTab, setAudiverisModalTab] = useState<'adjust' | 'inspect'>('adjust');
  const [inspectJobId, setInspectJobId] = useState<string | null>(null);
  const [audiverisTranspose, setAudiverisTranspose] = useState(0);
  const audiverisReplaceRef = useRef<HTMLInputElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadReviewRef = useRef<HTMLInputElement>(null);
  const tasksRef = useRef<ConvertTask[]>([]);

  tasksRef.current = tasks;

  useEffect(() => {
    try {
      localStorage.setItem('pdf2mxl_start_stage', startStage);
    } catch {
      /* ignore */
    }
  }, [startStage]);

  useEffect(() => {
    if (audiverisReviewJobId) setAudiverisModalTab('adjust');
  }, [audiverisReviewJobId]);

  const refreshHealth = useCallback(() => {
    return fetch('/api/health', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Health>;
      })
      .then(setHealth)
      .catch(() => setHealth({ ok: false, omrEngineReady: false }));
  }, []);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  useEffect(() => {
    return () => {
      revokeTaskUrls(tasksRef.current);
    };
  }, []);

  const addFilesFromList = useCallback((list: FileList | File[]) => {
    const arr = Array.from(list);
    setFiles((prev) => mergePdfFiles(prev, arr));
    const pdfCount = arr.filter(isPdfFile).length;
    if (!pdfCount) {
      setStatus('추가된 PDF가 없습니다 (.pdf 확장자·MIME 확인)');
      return;
    }
    if (pdfCount < arr.length) {
      setStatus(`PDF ${pdfCount}개 추가됨 (PDF가 아닌 항목은 제외)`);
    } else {
      setStatus(`PDF ${pdfCount}개 추가됨`);
    }
  }, []);

  const clearFiles = useCallback(() => {
    setFiles([]);
    setTasks([]);
    setStatus('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const removeFileAt = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const convertOne = useCallback(
    async (
      file: File | null,
      onProgress?: (p: TaskProgress | undefined) => void,
      onReviewNeeded?: (jobId: string) => void,
      onFontStripNeeded?: (jobId: string) => void,
      onCleanScorePreviewNeeded?: (jobId: string) => void,
      onAudiverisReviewNeeded?: (jobId: string) => void,
      onOmrStaffReviewNeeded?: (jobId: string) => void,
      onPartLabelsNeeded?: (jobId: string) => void,
      opts?: {
        pauseAfterAudiveris?: boolean;
        pipelineMode?: PipelineMode;
        enablePymupdfReview?: boolean;
        enableOmrStaffReview?: boolean;
        startStage?: StartStage;
        resumeCleanScoreFile?: File | null;
        resumeLyricManifestFile?: File | null;
        resumeOmrWorkFile?: File | null;
        resumeCorrectedMxlFile?: File | null;
      },
    ): Promise<Omit<ConvertTask, 'id' | 'fileName' | 'phase'>> => {
    const fd = new FormData();
    if (file) {
      fd.append('pdf', file);
    }
    fd.append('debug', 'false');
    fd.append('startStage', opts?.startStage ?? 'full');
    fd.append('pipelineMode', opts?.pipelineMode ?? 'font_separator');
    if (opts?.pipelineMode === 'font_separator') {
      fd.append('enablePymupdfReview', opts?.enablePymupdfReview !== false ? 'true' : 'false');
    }
    fd.append('enableOmrStaffReview', opts?.enableOmrStaffReview !== false ? 'true' : 'false');
    if (opts?.resumeCleanScoreFile) {
      fd.append('cleanScorePdf', opts.resumeCleanScoreFile);
    }
    if (opts?.resumeLyricManifestFile) {
      fd.append('lyricManifest', opts.resumeLyricManifestFile);
    }
    if (opts?.resumeOmrWorkFile) {
      fd.append('omrWorkZip', opts.resumeOmrWorkFile);
    }
    if (opts?.resumeCorrectedMxlFile) {
      fd.append('correctedMxl', opts.resumeCorrectedMxlFile);
    }
    if (opts?.pauseAfterAudiveris) {
      fd.append('pauseAfterAudiveris', 'true');
    }
    const acceptRes = await fetch('/api/convert', { method: 'POST', body: fd });
    const acceptCt = acceptRes.headers.get('Content-Type') ?? '';

    if (acceptRes.status !== 202) {
      let msg = `HTTP ${acceptRes.status}`;
      if (acceptCt.includes('application/json')) {
        const j = (await acceptRes.json()) as { error?: string; detail?: string; stderrTail?: string };
        msg = [j.error, j.detail, j.stderrTail].filter(Boolean).join('\n') || msg;
      } else {
        msg = await acceptRes.text();
      }
      return { errorMessage: msg };
    }

    const accepted = (await acceptRes.json()) as { jobId?: string };
    if (!accepted.jobId) {
      return { errorMessage: '서버에서 작업 ID(jobId)를 받지 못했습니다' };
    }
    const { jobId } = accepted;
    let reviewTriggered = false;
    let audiverisReviewTriggered = false;
    let omrStaffReviewTriggered = false;
    let partLabelsTriggered = false;

    for (;;) {
      const st = await fetch(`/api/status/${jobId}`, { cache: 'no-store' });
      const stCt = st.headers.get('Content-Type') ?? '';
      if (!st.ok) {
        let msg = `상태 조회 HTTP ${st.status}`;
        if (stCt.includes('application/json')) {
          const j = (await st.json()) as { error?: string };
          if (j.error) msg = j.error;
        }
        return { errorMessage: msg, jobId };
      }

      const j = (await st.json()) as {
        status: string;
        httpError?: number;
        error?: string;
        detail?: string;
        stdoutTail?: string;
        stderrTail?: string;
        progress?: TaskProgress;
      };

      if (j.progress) {
        onProgress?.(j.progress);
      } else {
        const derived = taskProgressFromJobStatus(j.status);
        if (derived) onProgress?.(derived);
      }

      if (j.status === 'font_strip_needed') {
        onFontStripNeeded?.(jobId);
      }

      if (j.status === 'clean_score_preview_needed') {
        onCleanScorePreviewNeeded?.(jobId);
      }

      if (j.status === 'review_needed' && !reviewTriggered) {
        reviewTriggered = true;
        onReviewNeeded?.(jobId);
      }

      if (j.status === 'part_labels_needed' && !partLabelsTriggered) {
        partLabelsTriggered = true;
        onPartLabelsNeeded?.(jobId);
      }

      if (j.status === 'omr_staff_review_needed' && !omrStaffReviewTriggered) {
        omrStaffReviewTriggered = true;
        onOmrStaffReviewNeeded?.(jobId);
      }

      if (j.status === 'audiveris_review_needed' && !audiverisReviewTriggered) {
        audiverisReviewTriggered = true;
        onAudiverisReviewNeeded?.(jobId);
      }

      if (j.status === 'failed') {
        const msg =
          [j.error, j.detail, j.stdoutTail, j.stderrTail].filter(Boolean).join('\n') ||
          `변환 실패 (HTTP ${j.httpError ?? '?'})`;
        return { errorMessage: msg, jobId };
      }

      if (j.status === 'completed') {
        break;
      }

      await sleep(POLL_INTERVAL_MS);
    }

    const dl = await fetch(`/api/download/${jobId}`);
    const dlCt = dl.headers.get('Content-Type') ?? '';

    if (!dl.ok) {
      let msg = `다운로드 HTTP ${dl.status}`;
      if (dlCt.includes('application/json')) {
        const errBody = (await dl.json()) as { error?: string };
        if (errBody.error) msg = errBody.error;
      } else {
        msg = await dl.text();
      }
      return { errorMessage: msg, jobId };
    }

    const blob = await dl.blob();
    const cd = dl.headers.get('Content-Disposition');
    let name = (file ? file.name.replace(/\.pdf$/i, '') : 'score') + (dlCt.includes('zip') ? '-parts.zip' : '.mxl');
    const mUtf8 = cd?.match(/filename\*=UTF-8''([^;]+)/i);
    if (mUtf8?.[1]) {
      name = decodeURIComponent(mUtf8[1]);
    } else {
      const m = cd?.match(/filename="([^"]+)"/);
      if (m?.[1]) name = m[1];
    }
    const downloadUrl = URL.createObjectURL(blob);
    onProgress?.(undefined);
    return { downloadUrl, downloadName: name, jobId };
  },
    [],
  );

  const runBatchWith = useCallback(
    async (listArg: File[], healthArg: Health | null, autoSaveFlag: boolean) => {
      const list = [...listArg];

      if (startStage === 'full' && list.length === 0) {
        setStatus('변환할 원본 PDF 파일을 목록에 추가해 주세요.');
        return;
      }
      if ((startStage === 'omr' || startStage === 'lyric_review') && !resumeCleanScoreFile && list.length === 0) {
        setStatus('clean_score_only.pdf 파일을 선택해 주세요.');
        return;
      }
      if (startStage === 'omr_hitl' && !resumeOmrWorkFile) {
        setStatus('이어할 OMR 검토 ZIP 파일(omr-work.zip)을 선택해 주세요.');
        return;
      }
      if (startStage === 'lyric_review_only') {
        if (!resumeCorrectedMxlFile) {
          setStatus('교정 완료된 MXL 파일을 선택해 주세요.');
          return;
        }
        if (!resumeLyricManifestFile) {
          setStatus('가사 manifest.json 파일을 선택해 주세요.');
          return;
        }
      }

      if (healthArg === null) {
        setStatus('서버 상태를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
      if (!healthArg.omrEngineReady) {
        setStatus(
          healthArg.omrEngine === 'pdftomusic'
            ? `PDFtoMusic Pro(p2mp)가 준비되지 않았습니다. ${healthArg.pdftomusicDepsHint ?? 'P2MP_BIN을 설정하세요.'}`
            : healthArg.omrEngine === 'ai'
              ? `AI OMR 의존성이 없습니다. ${healthArg.aiOmrDepsHint ?? 'pip install -r requirements.txt'}`
              : 'Audiveris 경로(AUDIVERIS_BIN)가 서버에 설정되어 있지 않습니다.',
        );
        return;
      }
      if (pipelineMode === 'font_separator' && healthArg.fontSeparatorDepsOk === false) {
        setStatus(
          `폰트 분리용 Python 패키지(pikepdf, pdfplumber)가 없습니다. 서버에서: ${healthArg.fontSeparatorDepsHint ?? 'pip install -r requirements.txt'}`,
        );
        return;
      }

      revokeTaskUrls(tasksRef.current);
      setPartLabelsJobId(null);
      setOmrStaffReviewJobId(null);
      setAudiverisReviewJobId(null);
      setFontStripJobId(null);
      setCleanScorePreviewJobId(null);
      setReviewingJobId(null);

      const runList: Array<File | null> = list.length > 0 ? list : [null];
      const initialTasks: ConvertTask[] = runList.map((f) => ({
        id: newTaskId(),
        fileName: f
          ? f.name
          : startStage === 'omr_hitl'
            ? (resumeOmrWorkFile?.name ?? 'omr-work.zip')
            : startStage === 'omr' || startStage === 'lyric_review'
              ? (resumeCleanScoreFile?.name ?? 'clean_score_only.pdf')
              : (resumeCorrectedMxlFile?.name ?? 'corrected.mxl'),
        phase: 'queued',
      }));
      setTasks(initialTasks);
      setBusy(true);
      setStatus(`총 ${runList.length}개 작업 시작`);

      try {
        for (let i = 0; i < runList.length; i++) {
          const file = runList[i];
          const taskId = initialTasks[i].id;

          setTasks((prev) =>
            prev.map((t) => (t.id === taskId ? { ...t, phase: 'running' } : t)),
          );

          try {
            const result = await convertOne(
              file,
              (p) => {
                setTasks((prev) =>
                  prev.map((t) => (t.id === taskId ? { ...t, progress: p } : t)),
                );
              },
              async (jobId) => {
                try {
                  const r = await fetch(`/api/review/${jobId}`);
                  if (r.ok) {
                    const dataRaw = (await r.json()) as unknown[];
                    const { items: payloadItems, manualLyricRects: fromPayload } =
                      partitionReviewPayload(Array.isArray(dataRaw) ? dataRaw : []);

                    const initData = payloadItems.map((item) => ({
                      ...item,
                      type: defaultReviewTypeForInit(item.type),
                      lyricPartIndex:
                        typeof item.lyricPartIndex === 'number' && item.lyricPartIndex >= 1
                          ? Math.floor(item.lyricPartIndex)
                          : 1,
                      lyricVerseIndex:
                        typeof item.lyricVerseIndex === 'number' && item.lyricVerseIndex >= 1
                          ? Math.floor(item.lyricVerseIndex)
                          : 1,
                      lyricVoice: (item.lyricVoice && String(item.lyricVoice).trim()) || '1',
                      lyricSkipNotes:
                        typeof item.lyricSkipNotes === 'number' && item.lyricSkipNotes >= 0
                          ? Math.floor(item.lyricSkipNotes)
                          : 0,
                    }));

                    setManualLyricRects(fromPayload);
                    setFocusedReviewRowIndex(null);
                    setReviewData(initData);
                    setReviewingJobId(jobId);
                    setReviewOriginalFileName(file ? file.name : (resumeCorrectedMxlFile?.name ?? 'corrected.mxl'));

                    const saved = localStorage.getItem('pdf2mxl_review_' + (file ? file.name : 'corrected.mxl'));
                    setHasSavedData(!!saved);
                  }
                } catch (e) {
                  console.error('Failed to fetch review data', e);
                }
              },
              (jobId) => {
                setFontStripJobId(jobId);
              },
              (jobId) => {
                setCleanScorePreviewJobId(jobId);
              },
              (jobId) => {
                setAudiverisTranspose(0);
                setAudiverisReviewJobId(jobId);
              },
              (jobId) => {
                setOmrStaffReviewJobId(jobId);
              },
              (jobId) => {
                setPartLabelsJobId(jobId);
              },
              {
                pauseAfterAudiveris,
                pipelineMode,
                enablePymupdfReview,
                enableOmrStaffReview,
                startStage,
                resumeCleanScoreFile,
                resumeLyricManifestFile,
                resumeOmrWorkFile,
                resumeCorrectedMxlFile,
              },
            );
            setTasks((prev) =>
              prev.map((t) => {
                if (t.id !== taskId) return t;
                if (result.errorMessage) {
                  return {
                    ...t,
                    phase: 'error',
                    errorMessage: result.errorMessage,
                    progress: undefined,
                    jobId: result.jobId ?? t.jobId,
                  };
                }
                return {
                  ...t,
                  phase: 'done',
                  progress: undefined,
                  jobId: result.jobId,
                  downloadUrl: result.downloadUrl,
                  downloadName: result.downloadName,
                };
              }),
            );

            if (autoSaveFlag && result.downloadUrl && !result.errorMessage) {
              const a = document.createElement('a');
              a.href = result.downloadUrl;
              a.download = result.downloadName || 'score.mxl';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setTasks((prev) =>
              prev.map((t) => (t.id === taskId ? { ...t, phase: 'error', errorMessage: msg, progress: undefined } : t)),
            );
          }
        }
        setStatus('변환 종료 — 결과를 저장하세요.');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus(`변환 준비 중 오류: ${msg}`);
        console.error(e);
      } finally {
        setBusy(false);
      }
    },
    [convertOne, pauseAfterAudiveris, pipelineMode, enablePymupdfReview, enableOmrStaffReview, startStage, resumeCleanScoreFile, resumeLyricManifestFile, resumeOmrWorkFile],
  );

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    setDragOver(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const dropped = extractPdfFilesFromDataTransfer(e.dataTransfer);
    if (dropped.length) addFilesFromList(dropped);
    else setStatus('여기에 놓인 파일에서 PDF를 찾지 못했습니다. 확장자 .pdf 인지 확인해 주세요.');
  };

  useEffect(() => {
    if (
      reviewingJobId &&
      reviewOriginalFileName &&
      (reviewData.length > 0 || manualLyricRects.length > 0)
    ) {
      const draft: StoredReviewDraftV2 = {
        v: 2,
        items: reviewData,
        manualLyricRects,
      };
      localStorage.setItem('pdf2mxl_review_' + reviewOriginalFileName, JSON.stringify(draft));
    }
  }, [reviewData, manualLyricRects, reviewingJobId, reviewOriginalFileName]);

  const handleLoadPrevious = () => {
    if (!reviewOriginalFileName) return;
    const saved = localStorage.getItem('pdf2mxl_review_' + reviewOriginalFileName);
    if (saved) {
       try {
         const parsed = JSON.parse(saved);
         const { items: restoredRows, manualLyricRects: restoredRects } =
           loadReviewDraftFromLocalStorageJson(parsed);
         const merged = reviewData.map((item) => {
            const match = restoredRows.find((p: { id?: string }) => p.id === item.id);
            return match ? mergeReviewFieldsFromSaved(item, match as Record<string, unknown>) : item;
         });
         setReviewData(merged);
         if (restoredRects.length > 0) setManualLyricRects(restoredRects);
       } catch (e) {
         console.error('Failed to load saved data', e);
       }
    }
  };

  const handleDownloadReview = () => {
    const draft: StoredReviewDraftV2 = {
      v: 2,
      items: reviewData,
      manualLyricRects,
    };
    const jsonStr = JSON.stringify(draft, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `review_backup_${reviewOriginalFileName || 'data'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleUploadReview = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
       try {
         const parsed = JSON.parse(ev.target?.result as string);
         const { items: backupRows, manualLyricRects: fromFile } =
           loadReviewDraftFromLocalStorageJson(parsed);
         if (backupRows.length > 0) {
            const merged = reviewData.map((item) => {
               const match = backupRows.find((p: { id?: string }) => p.id === item.id);
               return match ? mergeReviewFieldsFromSaved(item, match as Record<string, unknown>) : item;
            });
            setReviewData(merged);
         }
         if (fromFile.length > 0) setManualLyricRects(fromFile);
       } catch (err) {
         alert('올바른 백업 파일(.json)이 아닙니다.');
       }
       if (uploadReviewRef.current) uploadReviewRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const submitReview = async () => {
    if (!reviewingJobId) return;
      const normalizedItems = reviewData.map((item) => {
        if (item.type !== 'lyrics') return item;
        const lv = item.lyricVoice?.trim();
        const vn =
          typeof item.lyricVerseIndex === 'number' && item.lyricVerseIndex >= 1
            ? Math.floor(item.lyricVerseIndex)
            : 1;
        return {
          ...item,
          lyricVoice: lv && lv.length > 0 ? lv : '1',
          lyricVerseIndex: Math.min(32, vn),
        };
      });
    try {
      const maskMeta =
        manualLyricRects.length > 0
          ? [
              {
                id: MANUAL_LYRIC_MASK_ID,
                type: MANUAL_LYRIC_MASK_TYPE,
                page: 1,
                text: '',
                confidence: 1,
                x: 0,
                y: 0,
                manualRects: manualLyricRects,
              },
            ]
          : [];

      const res = await fetch(`/api/review/${reviewingJobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [...normalizedItems, ...maskMeta],
          partLabelsPreset: partLabelsPreset.slice(0, partLabelCount),
        }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          msg = await res.text();
        }
        alert(msg);
        return;
      }
      if (reviewOriginalFileName) {
         localStorage.removeItem('pdf2mxl_review_' + reviewOriginalFileName);
      }
      setReviewingJobId(null);
      setReviewData([]);
      setManualLyricRects([]);
      setFocusedReviewRowIndex(null);
      setReviewOriginalFileName('');
      setHasSavedData(false);
    } catch (e) {
      console.error(e);
      alert('리뷰 제출 실패');
    }
  };

  const submitContinueOmrStaffReview = async () => {
    if (!omrStaffReviewJobId) return;
    setOmrStaffContinueBusy(true);
    try {
      const r = await fetch(`/api/continue-omr-staff-review/${omrStaffReviewJobId}`, {
        method: 'POST',
      });
      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try {
          const j = (await r.json()) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          msg = await r.text();
        }
        alert(msg);
        return;
      }
      setOmrStaffReviewJobId(null);
    } catch (e) {
      console.error(e);
      alert('OMR 검토 이어하기 요청 실패');
    } finally {
      setOmrStaffContinueBusy(false);
    }
  };

  const submitContinueAudiveris = async () => {
    if (!audiverisReviewJobId) return;
    const fd = new FormData();
    fd.append('transposeSemitones', String(audiverisTranspose));
    const rep = audiverisReplaceRef.current?.files?.[0];
    if (rep) fd.append('mxl', rep);
    try {
      const r = await fetch(`/api/continue-audiveris/${audiverisReviewJobId}`, {
        method: 'POST',
        body: fd,
      });
      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try {
          const j = (await r.json()) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          msg = await r.text();
        }
        alert(msg);
        return;
      }
      setAudiverisReviewJobId(null);
      setAudiverisTranspose(0);
      if (audiverisReplaceRef.current) audiverisReplaceRef.current.value = '';
    } catch (e) {
      console.error(e);
      alert('OMR 이어하기 요청 실패');
    }
  };

  const handleReviewItemBBoxCommit = useCallback(
    (itemIndex: number, bbox: [number, number, number, number]) => {
      setReviewData((prev) =>
        prev.map((item, idx) =>
          idx === itemIndex ? { ...item, bbox: [...bbox], spans: undefined } : item,
        ),
      );
    },
    [],
  );

  const scrollReviewRowIntoView = (i: number) => {
    requestAnimationFrame(() => {
      reviewRowRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  };

  const handleReviewTypeChange = (index: number, type: string) => {
    const newData = [...reviewData];
    newData[index].type = type;
    if (type === 'lyrics') {
      if (newData[index].lyricPartIndex == null || newData[index].lyricPartIndex! < 1) {
        newData[index].lyricPartIndex = 1;
      }
      if (newData[index].lyricVerseIndex == null || newData[index].lyricVerseIndex! < 1) {
        newData[index].lyricVerseIndex = 1;
      }
      if (newData[index].lyricVoice == null || newData[index].lyricVoice === '') {
        newData[index].lyricVoice = '1';
      }
      if (newData[index].lyricSkipNotes == null || newData[index].lyricSkipNotes! < 0) {
        newData[index].lyricSkipNotes = 0;
      }
    }
    setReviewData(newData);
  };

  const handleReviewTextChange = (index: number, newText: string) => {
    const newData = [...reviewData];
    newData[index].text = newText;
    setReviewData(newData);
  };

  const handleLyricVerseIndexChange = (index: number, v: number) => {
    const newData = [...reviewData];
    newData[index].lyricVerseIndex = Number.isFinite(v) && v >= 1 ? Math.min(32, Math.floor(v)) : 1;
    setReviewData(newData);
  };

  const handleLyricPartIndexChange = (index: number, v: number) => {
    const newData = [...reviewData];
    newData[index].lyricPartIndex = Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1;
    setReviewData(newData);
  };

  const handleLyricVoicePresetChange = (index: number, v: string) => {
    const newData = [...reviewData];
    if (v === '__custom__') {
      const cur = (newData[index].lyricVoice ?? '').trim();
      newData[index].lyricVoice = (LYRIC_VOICE_PRESETS as readonly string[]).includes(cur)
        ? '5'
        : cur || '5';
    } else {
      newData[index].lyricVoice = v;
    }
    setReviewData(newData);
  };

  const handleLyricVoiceCustomInputChange = (index: number, v: string) => {
    const newData = [...reviewData];
    newData[index].lyricVoice = v;
    setReviewData(newData);
  };

  const handleLyricSkipNotesChange = (index: number, v: number) => {
    const newData = [...reviewData];
    newData[index].lyricSkipNotes = Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
    setReviewData(newData);
  };

  return (
    <div className="page">
      <div className="card">
        <h1>PDF → MusicXML (Audiveris)</h1>
        <p className="sub">
          mxlplayer와 동일하게 <strong>Vite + React + TypeScript</strong>입니다. 악보 인식은{' '}
          <strong>Audiveris</strong>로 <code>clean_score_only.pdf</code>를 MusicXML로 변환하고, 검증된
          가사(<code>inject_ocr.py</code>)를 병합합니다. 결과는 표준 <code>.mxl</code> /
          <code>.musicxml</code> 이라 mxlplayer의 업로드(.xml / .musicxml / .mxl)와 호환됩니다.
        </p>

        {/* 버튼은 드롭존 밖에 두어, 자식 위로 드래그할 때 dragleave/드롭 타깃 문제를 피함 */}
        {/* 단계별 선택 카드 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1.15rem', margin: '0 0 0.5rem' }}>변환 시작 단계 선택</h2>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
            <button
              type="button"
              className={startStage === 'full' ? 'btn-primary' : 'btn-secondary'}
              style={{
                padding: '1.15rem 0.75rem',
                height: 'auto',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.4rem',
                borderRadius: 8,
                border: startStage === 'full' ? '1px solid #3b82f6' : '1px solid #444',
                background: startStage === 'full' ? '#1e40af' : '#222',
                color: '#fff',
                cursor: 'pointer',
                transition: 'all 0.2s ease-in-out',
                boxShadow: startStage === 'full' ? '0 0 10px rgba(59, 130, 246, 0.4)' : 'none'
              }}
              onClick={() => {
                setStartStage('full');
                setPipelineMode('font_separator');
                setEnablePymupdfReview(true);
              }}
              disabled={busy}
            >
              <span style={{ fontWeight: 'bold', fontSize: '1.05rem' }}>1단계부터 시작</span>
              <span style={{ fontSize: '0.82rem', opacity: 0.85 }}>원본 PDF 업로드</span>
            </button>
            
            <button
              type="button"
              className={(startStage === 'lyric_review' || startStage === 'omr' || startStage === 'omr_hitl') ? 'btn-primary' : 'btn-secondary'}
              style={{
                padding: '1.15rem 0.75rem',
                height: 'auto',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.4rem',
                borderRadius: 8,
                border: (startStage === 'lyric_review' || startStage === 'omr' || startStage === 'omr_hitl') ? '1px solid #3b82f6' : '1px solid #444',
                background: (startStage === 'lyric_review' || startStage === 'omr' || startStage === 'omr_hitl') ? '#1e40af' : '#222',
                color: '#fff',
                cursor: 'pointer',
                transition: 'all 0.2s ease-in-out',
                boxShadow: (startStage === 'lyric_review' || startStage === 'omr' || startStage === 'omr_hitl') ? '0 0 10px rgba(59, 130, 246, 0.4)' : 'none'
              }}
              onClick={() => {
                setStartStage('omr');
                setPipelineMode('font_separator');
                setEnablePymupdfReview(false);
              }}
              disabled={busy}
            >
              <span style={{ fontWeight: 'bold', fontSize: '1.05rem' }}>2단계부터 시작</span>
              <span style={{ fontSize: '0.82rem', opacity: 0.85 }}>clean_score_only.pdf</span>
            </button>

            <button
              type="button"
              className={startStage === 'lyric_review_only' ? 'btn-primary' : 'btn-secondary'}
              style={{
                padding: '1.15rem 0.75rem',
                height: 'auto',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.4rem',
                borderRadius: 8,
                border: startStage === 'lyric_review_only' ? '1px solid #3b82f6' : '1px solid #444',
                background: startStage === 'lyric_review_only' ? '#1e40af' : '#222',
                color: '#fff',
                cursor: 'pointer',
                transition: 'all 0.2s ease-in-out',
                boxShadow: startStage === 'lyric_review_only' ? '0 0 10px rgba(59, 130, 246, 0.4)' : 'none'
              }}
              onClick={() => {
                setStartStage('lyric_review_only');
                setPipelineMode('font_separator');
                setEnablePymupdfReview(true);
              }}
              disabled={busy}
            >
              <span style={{ fontWeight: 'bold', fontSize: '1.05rem' }}>3단계부터 시작</span>
              <span style={{ fontSize: '0.82rem', opacity: 0.85 }}>교정 완료 MXL + 가사</span>
            </button>
          </div>

          <div style={{ background: '#181818', border: '1px solid #333', borderRadius: 8, padding: '1.25rem' }}>
            {startStage === 'full' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.5, color: '#ddd' }}>
                  <strong>[1단계] 원본 PDF에서 clean_score_only.pdf 추출 및 전체 변환</strong>
                  <br />
                  원본 PDF에서 가사를 완전히 제거한 깨끗한 악보 PDF를 만들고, OMR 변환을 거쳐 가사를 점검하고 최종 병합하는 순차적 전체 흐름을 시작합니다.
                </p>
                <div
                  className={`dropzone ${dragOver ? 'dropzone-active' : ''}`}
                  onDragEnter={onDragEnter}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                  style={{
                    marginTop: '0.5rem',
                    background: dragOver ? '#1e3a8a' : '#222',
                    padding: '1.75rem 1.25rem',
                    borderRadius: 6,
                    border: '2px dashed #3b82f6',
                    textAlign: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease-in-out'
                  }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <p className="dropzone-title" style={{ margin: '0 0 0.25rem', fontWeight: 'bold', color: '#fff', fontSize: '0.95rem' }}>
                    원본 PDF 파일을 여기에 놓으세요
                  </p>
                  <p className="dropzone-hint" style={{ margin: 0, fontSize: '0.8rem', color: '#aaa' }}>
                    또는 클릭하여 파일 선택 (복수 파일 가능)
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    multiple
                    hidden
                    onChange={(e) => {
                      if (e.target.files) addFilesFromList(e.target.files);
                    }}
                    disabled={busy}
                  />
                </div>
              </div>
            )}

            {(startStage === 'lyric_review' || startStage === 'omr' || startStage === 'omr_hitl') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.5, color: '#ddd' }}>
                  <strong>[2단계] clean_score_only.pdf 또는 OMR 검토 ZIP</strong>
                  <br />
                  가사가 제거된 악보 PDF로 OMR(Audiveris)을 돌리거나, 저장해 둔 omr-work.zip으로 검토를 이어갑니다.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', borderBottom: '1px solid #333', paddingBottom: '0.50rem', marginBottom: '0.25rem' }}>
                  <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', cursor: 'pointer', fontSize: '0.88rem', color: '#fff' }}>
                    <input
                      type="radio"
                      name="step2Mode"
                      checked={startStage === 'omr'}
                      onChange={() => {
                        setStartStage('omr');
                        setEnablePymupdfReview(false);
                      }}
                      disabled={busy}
                    />
                    clean_score_only.pdf → OMR만 (가사 검증 생략)
                  </label>
                  <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', cursor: 'pointer', fontSize: '0.88rem', color: '#fff' }}>
                    <input
                      type="radio"
                      name="step2Mode"
                      checked={startStage === 'lyric_review'}
                      onChange={() => {
                        setStartStage('lyric_review');
                        setEnablePymupdfReview(true);
                      }}
                      disabled={busy}
                    />
                    clean_score_only.pdf → OMR + 가사 검증(PyMuPDF) 포함
                  </label>
                  <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', cursor: 'pointer', fontSize: '0.88rem', color: '#fff' }}>
                    <input
                      type="radio"
                      name="step2Mode"
                      checked={startStage === 'omr_hitl'}
                      onChange={() => setStartStage('omr_hitl')}
                      disabled={busy}
                    />
                    omr-work.zip으로 OMR 검토 이어하기 (Audiveris 생략)
                  </label>
                </div>

                {startStage === 'omr_hitl' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', background: '#222', padding: '0.75rem', borderRadius: 6, border: '1px solid #333' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.88rem', color: '#fff' }}>omr-work.zip 파일 선택 (필수)</span>
                    <input
                      type="file"
                      accept=".zip,application/zip"
                      onChange={(e) => setResumeOmrWorkFile(e.target.files?.[0] ?? null)}
                      disabled={busy}
                    />
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', background: '#222', padding: '0.75rem', borderRadius: 6, border: '1px solid #333' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.88rem', color: '#fff' }}>clean_score_only.pdf 파일 선택 (필수)</span>
                    <input
                      type="file"
                      accept=".pdf,application/pdf"
                      onChange={(e) => setResumeCleanScoreFile(e.target.files?.[0] ?? null)}
                      disabled={busy}
                    />
                  </div>
                )}

                {startStage !== 'omr_hitl' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', background: '#222', padding: '0.75rem', borderRadius: 6, border: '1px solid #333' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.88rem', color: '#fff' }}>lyric_manifest.json (선택 · 가사 검증 포함 모드)</span>
                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={(e) => setResumeLyricManifestFile(e.target.files?.[0] ?? null)}
                      disabled={busy || startStage === 'omr'}
                    />
                    <small style={{ color: '#aaa', fontSize: '0.78rem' }}>
                      {startStage === 'omr'
                        ? '「OMR만」 모드에서는 가사 manifest 없이 OMR·HITL만 진행합니다. 가사 검증이 필요하면 위에서 「OMR + 가사 검증 포함」을 선택하세요.'
                        : '이전 작업 시 저장해 둔 가사 JSON이 있으면 업로드하여 가사 교정을 이어갈 수 있습니다.'}
                    </small>
                  </div>
                ) : null}
              </div>
            )}

            {startStage === 'lyric_review_only' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.5, color: '#ddd' }}>
                  <strong>[3단계] 교정 완료된 MXL 기반으로 가사 점검 및 편집</strong>
                  <br />
                  OMR HITL 편집창이나 외부 악보 프로그램에서 완전히 음표 교정을 끝낸 MXL 악보와 가사 JSON 정보를 바탕으로 최종 가사 배치 및 보정을 시작합니다.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', background: '#222', padding: '0.75rem', borderRadius: 6, border: '1px solid #333' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.88rem', color: '#fff' }}>교정 완료된 악보 파일 (.mxl 또는 .musicxml, 필수)</span>
                  <input
                    type="file"
                    accept=".mxl,.musicxml,.xml"
                    onChange={(e) => setResumeCorrectedMxlFile(e.target.files?.[0] ?? null)}
                    disabled={busy}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', background: '#222', padding: '0.75rem', borderRadius: 6, border: '1px solid #333', marginTop: '0.25rem' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.88rem', color: '#fff' }}>가사 manifest.json 파일 (.json, 필수)</span>
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={(e) => setResumeLyricManifestFile(e.target.files?.[0] ?? null)}
                    disabled={busy}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="row dropzone-actions" style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-primary"
            style={{ padding: '0.6rem 1.5rem', fontSize: '0.95rem', fontWeight: 600 }}
            disabled={
              (startStage === 'full' && !files.length) ||
              ((startStage === 'omr' || startStage === 'lyric_review') && !resumeCleanScoreFile && !files.length) ||
              (startStage === 'omr_hitl' && !resumeOmrWorkFile) ||
              (startStage === 'lyric_review_only' && (!resumeCorrectedMxlFile || !resumeLyricManifestFile)) ||
              !health?.omrEngineReady ||
              busy ||
              (pipelineMode === 'font_separator' && health?.fontSeparatorDepsOk === false)
            }
            onClick={() =>
              void runBatchWith(files, health, autoSave).catch((err: unknown) => {
                console.error(err);
                setBusy(false);
                setStatus(`오류: ${err instanceof Error ? err.message : String(err)}`);
              })
            }
          >
            {busy ? '처리 중…' : '변환 시작'}
          </button>

          {startStage === 'full' && files.length > 0 && (
            <button type="button" className="btn-secondary" style={{ padding: '0.6rem 1.25rem' }} disabled={busy} onClick={clearFiles}>
              목록 비우기
            </button>
          )}
        </div>

        <div className="row" style={{ marginTop: '0.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-color, inherit)' }}>
            <input
              type="checkbox"
              checked={autoSave}
              onChange={(e) => setAutoSave(e.target.checked)}
              disabled={busy}
            />
            결과 저장하기
          </label>
          <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-color, inherit)' }}>
            <input
              type="checkbox"
              checked={pauseAfterAudiveris}
              onChange={(e) => setPauseAfterAudiveris(e.target.checked)}
              disabled={busy}
            />
            OMR 직후 멈춤 (MXL 다운로드·조옮김·교체 후 이어하기)
          </label>
          <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-color, inherit)' }}>
            <input
              type="checkbox"
              checked={enableOmrStaffReview}
              onChange={(e) => setEnableOmrStaffReview(e.target.checked)}
              disabled={busy}
            />
            OMR 직후 품질 검토 (페이지×성부 lint, 기본 켜짐)
          </label>
        </div>

        {files.length > 0 && (
          <ul className="file-list">
            {files.map((f, i) => (
              <li key={taskKey(f)}>
                <span className="file-list-name">{f.name}</span>
                <button type="button" className="btn-link" disabled={busy} onClick={() => removeFileAt(i)}>
                  제거
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className={`status ${health?.omrEngineReady ? 'ok' : 'err'}`}>
          {health === null && '서버 상태 확인 중…'}
          {health && !health.omrEngineReady && (
            <>
              {health.omrEngine === 'pdftomusic' ? (
                <>PDFtoMusic Pro(p2mp)가 준비되지 않았습니다.</>
              ) : health.omrEngine === 'ai' ? (
                <>AI OMR 엔진이 준비되지 않았습니다.</>
              ) : (
                <>Audiveris가 준비되지 않았습니다.</>
              )}
              <br />
              {health.omrEngine === 'audiveris' || !health.omrEngine ? (
                <>
                  <code>export AUDIVERIS_BIN=/opt/audiveris/bin/Audiveris</code>
                </>
              ) : health.omrEngine === 'pdftomusic' ? (
                health.pdftomusicDepsHint ? (
                  <>
                    {health.pdftomusicDepsHint}
                    <br />
                    <code>P2MP_BIN</code> 예: Linux <code>/usr/bin/p2mp</code>, Windows{' '}
                    <code>C:\Program Files\PDFtoMusic Pro\p2mp.exe</code>
                  </>
                ) : (
                  <>
                    <code>P2MP_BIN</code>을 설정하세요. 벡터 PDF(악보 편집기 내보내기) 전용입니다.
                  </>
                )
              ) : health.omrEngine === 'ai' ? (
                <>
                  <code>pip install -r requirements.txt</code>
                  {health.aiOmrDepsHint ? (
                    <>
                      <br />
                      {health.aiOmrDepsHint}
                    </>
                  ) : health.aiOmrMissingModules?.length ? (
                    <>
                      <br />
                      누락: {health.aiOmrMissingModules.join(', ')}
                    </>
                  ) : null}
                </>
              ) : null}
              <br />
              서버를 다시 실행하세요.
            </>
          )}
          {health?.omrEngineReady && (
            <div style={{ marginTop: '0.35rem', fontSize: '0.9rem' }}>
              OMR:{' '}
              <strong>
                {health.omrEngine === 'pdftomusic'
                  ? 'PDFtoMusic Pro (선택)'
                  : health.omrEngine === 'ai'
                    ? 'AI (실험)'
                    : 'Audiveris'}
              </strong>
              {health.omrEngine === 'ai' && (
                <>
                  {' '}
                  (backend={health.aiOmrBackend ?? 'homr'}
                  {health.aiOmrCudaAvailable ? ', CUDA' : ''})
                </>
              )}
              {health.omrEngineDetail ? ` — ${health.omrEngineDetail}` : ''}
            </div>
          )}
          {health?.fontSeparatorDepsOk === false && (
            <div
              className="status err"
              style={{ marginTop: '0.75rem', lineHeight: 1.55, fontSize: '0.9rem' }}
            >
              <strong>폰트 분리 패키지 없음</strong> ({health.fontSeparatorMissingModules?.join(', ') ?? 'pikepdf, pdfplumber'}
              ). Linux 서버 SSH에서 한 번 설치하세요:
              <pre
                style={{
                  margin: '0.5rem 0',
                  padding: '0.65rem',
                  background: 'rgba(0,0,0,0.06)',
                  borderRadius: 4,
                  overflowX: 'auto',
                  fontSize: '0.82rem',
                }}
              >
                {`cd /mnt/jj/pdf2musicxml
source venv/bin/activate
pip install -r requirements.txt
# pikepdf 빌드 실패 시: sudo apt-get install -y libqpdf-dev && pip install pikepdf pdfplumber
bash scripts/install-font-separator-deps.sh`}
              </pre>
              설치·Node(PM2) 재시작 후{' '}
              <button type="button" className="btn-link" onClick={() => void refreshHealth()}>
                서버 상태 새로고침
              </button>
              . 당장 변환하려면 아래에서{' '}
              <button
                type="button"
                className="btn-link"
                onClick={() => {
                  setPipelineMode('pymupdf_review');
                  setStatus('PyMuPDF 검증 + 마스킹 방식으로 전환했습니다. 변환 버튼을 눌러 주세요.');
                }}
              >
                PyMuPDF 방식으로 전환
              </button>
              .
            </div>
          )}

          {health?.audiverisLegacyEngine && health.audiverisConfigured && health.audiverisPauseOnWarn && (
            <>
              <br />
              <span style={{ fontSize: '0.9em' }}>
                Audiveris 로그에 WARN이 나오면 자동으로 <strong>결과 보정</strong> 단계에서 멈춥니다 (
                <code>AUDIVERIS_PAUSE_ON_WARN</code>).
              </span>
            </>
          )}
        </div>

        {health?.omrEngineReady && (health.jobRetentionNote ?? health.jobRetentionHours != null) && (
          <p className="sub retention-note" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
            {health.jobRetentionNote ??
              `변환이 끝난 뒤 서버에 올라온 결과는 최대 ${health.jobRetentionHours}시간 동안만 보관됩니다. 그 안에 다운로드해 주세요.`}
          </p>
        )}

        {status && <div className="status">{status}</div>}

        {tasks.length > 0 && (
          <table className="task-table">
            <thead>
              <tr>
                <th>파일</th>
                <th>상태</th>
                <th>결과</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td className="task-name">{t.fileName}</td>
                  <td>
                    {t.phase === 'queued' && '대기'}
                    {t.phase === 'running' && (
                      <div className="task-status-running">
                        {!t.progress && <span>변환 중…</span>}
                        {t.progress && (
                          <>
                            <div className="task-progress-line" title={formatTaskProgressLine(t.progress)}>
                              {formatTaskProgressLine(t.progress)}
                            </div>
                            {t.progress.total > 0 ? (
                              <div className="task-progress-track" aria-hidden>
                                <div
                                  className="task-progress-fill"
                                  style={{
                                    width: `${Math.min(
                                      100,
                                      (100 * Math.min(t.progress.current, t.progress.total)) / t.progress.total,
                                    )}%`,
                                  }}
                                />
                              </div>
                            ) : (
                              <div className="task-progress-indeterminate" aria-hidden>
                                <div className="task-progress-indeterminate-bar" />
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    {t.phase === 'done' && <span className="ok">완료</span>}
                    {t.phase === 'error' && <span className="err">실패</span>}
                  </td>
                  <td>
                    {t.phase === 'done' && t.downloadUrl && (
                      <>
                        <a href={t.downloadUrl} download={t.downloadName}>
                          저장
                        </a>
                        {t.jobId && (
                          <>
                            {' · '}
                            <button
                              type="button"
                              className="btn-link"
                              onClick={() => setInspectJobId(t.jobId!)}
                            >
                              마스킹·인식 점검
                            </button>
                          </>
                        )}
                      </>
                    )}
                    {t.phase === 'error' && (
                      <>
                        <span className="err task-err" title={t.errorMessage}>
                          {t.errorMessage ?? ''}
                        </span>
                        {t.jobId && (
                          <>
                            {' · '}
                            <button
                              type="button"
                              className="btn-link"
                              onClick={() => setInspectJobId(t.jobId!)}
                            >
                              마스킹·인식 점검
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <p className="sub" style={{ margin: 0 }}>
          CLI만 쓰려면: <code>npm run convert -- &quot;악보.pdf&quot;</code> → 기본 저장 위치는{' '}
          <strong>Downloads</strong> 폴더입니다.
        </p>
      </div>

        {fontStripJobId &&
          createPortal(
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.55)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9998,
            }}
          >
            <div className="font-strip-modal">
              <FontStripPanel jobId={fontStripJobId} onSubmitted={() => setFontStripJobId(null)} />
            </div>
          </div>,
          document.body,
        )}

      {cleanScorePreviewJobId &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.55)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9998,
            }}
          >
            <div className="font-strip-modal clean-score-preview-modal">
              <CleanScorePreviewPanel
                jobId={cleanScorePreviewJobId}
                onContinue={() => setCleanScorePreviewJobId(null)}
                onRedoFontStrip={() => {
                  setCleanScorePreviewJobId(null);
                  setFontStripJobId(cleanScorePreviewJobId);
                }}
              />
            </div>
          </div>,
          document.body,
        )}

      {reviewingJobId && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
        }}>
          <div
            className="modal-light"
            style={{
              padding: '2rem',
              borderRadius: '8px',
              maxWidth: 'min(1120px, 96vw)',
              maxHeight: '88vh',
              overflowY: 'auto',
              width: '95%',
              boxShadow: '0 16px 48px rgba(0,0,0,0.35)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 0 }}>
               <h2 style={{ margin: 0 }}>문자 검토 및 매핑 (OMR 실행 전)</h2>
               <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {hasSavedData && (
                     <button onClick={handleLoadPrevious} style={{ padding: '0.5rem 1rem', background: '#f57c00', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                        이전 작업 불러오기
                     </button>
                  )}
                  <button onClick={handleDownloadReview} style={{ padding: '0.5rem 1rem', background: '#eee', color: '#333', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer' }}>
                     백업(.json) 저장
                  </button>
                  <label style={{ padding: '0.5rem 1rem', background: '#eee', color: '#333', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', display: 'inline-block' }}>
                     불러오기
                     <input type="file" ref={uploadReviewRef} accept=".json" style={{ display: 'none' }} onChange={handleUploadReview} />
                  </label>
               </div>
            </div>
            <p style={{ marginTop: '0.5rem', color: '#333' }}>
              인식된 글자가 제목인지, 가사인지 등 역할을 지정해주세요.
              {pipelineMode === 'font_separator' ? (
                <>
                  {' '}
                  (앞 단계에서 선택한 폰트 크기로 <code>clean_score_only.pdf</code>가 만들어지고
                  <strong> 원본과 나란히 확인</strong>한 뒤) pdfplumber·검토
                  결과가 <code>lyric_manifest.json</code>(v3)으로 병합되고 MusicXML에 주입됩니다.
                </>
              ) : (
                <>
                  {' '}
                  지정된 영역은 OMR에 넘어가기 전 하얗게 마스킹됩니다.
                </>
              )}
              {' '}
              템포는 숫자만(예: 75) 또는 ♩= 75 형태로 편집하면 MusicXML에 <code>sound tempo</code>로 들어갑니다.
            </p>
            <div
              style={{
                marginTop: '1rem',
                padding: '1rem',
                borderRadius: '6px',
                background: '#f5f5f5',
                border: '1px solid #ccc',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: '0.5rem', color: '#111' }}>
                성부 라벨 (PDF 페이지 번호와 구분)
              </div>
              <p style={{ margin: '0 0 0.75rem', fontSize: '0.88rem', color: '#444', lineHeight: 1.45 }}>
                가사를 붙일 <strong>성부</strong>를 S/A/T/B/PR/PL 등으로 미리 정합니다. OMR
                lint에서도 동일 라벨을 씁니다.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <button type="button" className="btn-muted" onClick={() => {
                  setPartLabelCount(6);
                  setPartLabelsPreset(defaultPartLabels(6));
                }}>
                  합창+피아노 6
                </button>
                <button type="button" className="btn-muted" onClick={() => {
                  setPartLabelCount(4);
                  setPartLabelsPreset(['S', 'A', 'T', 'B']);
                }}>
                  SATB 4
                </button>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.88rem' }}>
                  파트 수
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={partLabelCount}
                    onChange={(e) => {
                      const n = Math.max(1, Math.min(12, parseInt(e.target.value, 10) || 1));
                      setPartLabelCount(n);
                      setPartLabelsPreset((prev) => defaultPartLabels(n).map((d, i) => prev[i] ?? d));
                    }}
                    style={{ width: '3rem', padding: '0.3rem' }}
                  />
                </label>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem' }}>
                {partLabelsPreset.slice(0, partLabelCount).map((lab, i) => (
                  <label key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.78rem' }}>
                    <span style={{ fontWeight: 700, color: '#0d47a1' }}>파트 {i + 1}</span>
                    <input
                      type="text"
                      value={lab}
                      onChange={(e) =>
                        setPartLabelsPreset((prev) => {
                          const next = [...prev];
                          next[i] = e.target.value.trim();
                          return next;
                        })
                      }
                      style={{ width: '3.25rem', padding: '0.35rem', textAlign: 'center' }}
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="status" style={{ background: '#e3f2fd', color: '#0d47a1', border: '1px solid #bbdefb', padding: '1rem', borderRadius: '4px', marginTop: '1rem' }}>
              <strong>💡 가사 매핑 및 임시 저장 안내</strong><br/>
              가사를 선택하면 텍스트를 직접 편집할 수 있습니다. 쉼표·연장선 등으로 <strong>가사가 없는 음표</strong>는 해당 음절 자리에 <strong>하이픈( - )</strong>을 넣으세요 — 음표 하나를 소모하고 최종 MXL에도 <code>&lt;text&gt;-&lt;/text&gt;</code>로 표시됩니다. (띄어쓰기는 무시됨)<br/>
              <strong>파트·가사 절·멜로디 줄:</strong> <strong>파트 순번</strong>은 MusicXML의 몇 번째 악기/성부인지(1=첫 파트)입니다. <strong>가사 절</strong>(1절·2절…)은 같은 멜로디에 붙는 <strong>서로 다른 가사 줄</strong>이며, 병합 시 같은 음표에 <code>lyric number=&quot;1&quot;</code>, <code>&quot;2&quot;</code>…로 나뉩니다. <strong>멜로디 줄(voice)</strong>은 같은 마디에서 <strong>동시에 울리는 서로 다른 선율</strong>(성부 2줄 등)에 쓰는 MusicXML <code>&lt;voice&gt;</code>이며 <em>1절/2절과 다릅니다</em>. 한 줄만 있는 성부는 보통 멜로디 줄 1과 가사 절만 쓰면 됩니다. 피아노·2멜로디 한 파트면 <strong>전체 순서 (*)</strong> 또는 해당 <code>&lt;voice&gt;</code> 번호를 지정하세요. 가사가 중간부터 밀리면 <strong>앞쪽 음표 건너뛰기</strong>와 하이픈(<strong>-</strong>)을 쓰세요.<br/>
              <strong>OCR 신뢰도:</strong> 블록 옆 숫자는 글자 인식 점수(참고용)입니다.<br/>
              <em>모든 수정 사항은 브라우저에 임시 자동 저장됩니다. 변환 실패 시 파일을 다시 올려 '이전 작업 불러오기'를 누르면 복구됩니다. 수동 가사 지우기 영역은 백업·임시 저장에 포함됩니다.</em>
            </div>

            {reviewingJobId ? (
              <ManualLyricMaskPanel
                jobId={reviewingJobId}
                value={manualLyricRects}
                onChange={setManualLyricRects}
                reviewItems={reviewData}
                focusedReviewIndex={focusedReviewRowIndex}
                onFocusedReviewIndexChange={setFocusedReviewRowIndex}
                onReviewItemBBoxChange={handleReviewItemBBoxCommit}
              />
            ) : null}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '1.5rem' }}>
              {reviewData.map((item, i) => (
                <div
                  key={item.id}
                  ref={(el) => {
                    reviewRowRefs.current[i] = el;
                  }}
                  className={`review-row-card${
                    item.type === 'lyrics'
                      ? ' review-row-card--lyrics'
                      : item.type === 'tempo'
                        ? ' review-row-card--tempo'
                        : ''
                  }`}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                    padding: '1rem',
                    borderRadius: '4px',
                    outline:
                      focusedReviewRowIndex === i ? '2px solid #00897b' : 'none',
                    outlineOffset: 2,
                  }}
                >
                  <div className="review-controls-row">
                      <button
                        type="button"
                        onClick={() => {
                          setFocusedReviewRowIndex(i);
                          scrollReviewRowIntoView(i);
                        }}
                        style={{
                          padding: '0.35rem 0.6rem',
                          fontSize: '0.82rem',
                          border: '1px solid #00897b',
                          borderRadius: '4px',
                          background: focusedReviewRowIndex === i ? '#b2dfdb' : '#fff',
                          color: '#004d40',
                          cursor: 'pointer',
                          alignSelf: 'flex-end',
                        }}
                        title="위 미리보기에서 이 줄의 bbox를 표시·편집합니다"
                      >
                        미리보기
                      </button>
                      <label className="review-field">
                        <span className="review-field-label">구분</span>
                        <select
                         value={item.type} 
                         onChange={(e) => handleReviewTypeChange(i, e.target.value)}
                         style={{ padding: '0.45rem', fontSize: '0.95rem', minWidth: '9.5rem' }}
                      >
                         <option value="unknown">악보 기호 (마스킹 X)</option>
                         <option value="title">제목</option>
                         <option value="composer">작곡가</option>
                         <option value="lyricist">작사가</option>
                         <option value="copyright">저작권</option>
                         <option value="tempo">템포(BPM)</option>
                         <option value="lyrics">가사</option>
                      </select>
                      </label>
                      {item.type === 'lyrics' && (
                        <>
                          <label className="review-field">
                            <span className="review-field-label">성부</span>
                            <select
                              value={item.lyricPartIndex ?? 1}
                              onChange={(e) =>
                                handleLyricPartIndexChange(i, parseInt(e.target.value, 10))
                              }
                              style={{ padding: '0.4rem', minWidth: '6.5rem' }}
                              title="MusicXML part 순서 — 위 성부 라벨과 동일"
                            >
                              {partLabelsPreset.slice(0, partLabelCount).map((lab, idx) => (
                                <option key={idx} value={idx + 1}>
                                  {lab} (파트 {idx + 1})
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="review-field">
                            <span className="review-field-label">가사 절</span>
                            <input
                              type="number"
                              min={1}
                              max={32}
                              title="1절=1, 2절=2 … MusicXML lyric number"
                              value={item.lyricVerseIndex ?? 1}
                              onChange={(e) =>
                                handleLyricVerseIndexChange(i, parseInt(e.target.value, 10))
                              }
                              style={{ width: '3.5rem', padding: '0.4rem' }}
                            />
                          </label>
                          <label className="review-field">
                            <span className="review-field-label">멜로디 줄</span>
                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                              <select
                                value={lyricVoicePresetKey(item.lyricVoice)}
                                onChange={(e) => handleLyricVoicePresetChange(i, e.target.value)}
                                style={{ padding: '0.4rem', minWidth: '7.5rem' }}
                                title="MusicXML &lt;voice&gt;: 동시에 울리는 다른 선율. 1절/2절과 무관."
                              >
                                <option value="1">1</option>
                                <option value="2">2</option>
                                <option value="3">3</option>
                                <option value="4">4</option>
                                <option value="*">전체 (*)</option>
                                <option value="__custom__">직접</option>
                              </select>
                              {lyricVoicePresetKey(item.lyricVoice) === '__custom__' && (
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  title="MusicXML voice 번호"
                                  value={item.lyricVoice ?? ''}
                                  onChange={(e) => handleLyricVoiceCustomInputChange(i, e.target.value)}
                                  style={{ width: '2.75rem', padding: '0.4rem' }}
                                />
                              )}
                            </div>
                          </label>
                          <label className="review-field">
                            <span className="review-field-label">앞쪽 음표 생략</span>
                            <input
                              type="number"
                              min={0}
                              max={999}
                              value={item.lyricSkipNotes ?? 0}
                              onChange={(e) =>
                                handleLyricSkipNotesChange(i, parseInt(e.target.value, 10))
                              }
                              style={{ width: '3.5rem', padding: '0.4rem' }}
                            />
                          </label>
                        </>
                      )}
                      <label className="review-field review-field-grow">
                        <span className="review-field-label">텍스트</span>
                        <input
                          type="text"
                          value={item.text}
                          onChange={(e) => handleReviewTextChange(i, e.target.value)}
                          style={{ padding: '0.45rem', fontSize: '0.95rem', width: '100%', fontFamily: 'monospace' }}
                        />
                      </label>
                      {typeof item.confidence === 'number' && Number.isFinite(item.confidence) && (
                        <span
                          title="OCR 엔진이 준 글자 인식 신뢰도(참고용)"
                          style={{
                            fontSize: '0.82rem',
                            color: item.confidence < 0.8 ? '#b71c1c' : '#444',
                            fontWeight: item.confidence < 0.8 ? 600 : 500,
                            alignSelf: 'flex-end',
                            paddingBottom: '0.35rem',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          신뢰도 {Math.round(Math.max(0, Math.min(1, item.confidence)) * 100)}%
                          {item.confidence < 0.8 ? ' · 확인' : ''}
                        </span>
                      )}
                  </div>
                  
                  {item.type === 'lyrics' && (
                    <>
                      <div
                        className="review-char-strip"
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '8px',
                          marginTop: '0.25rem',
                          padding: '0.5rem',
                          borderRadius: '4px',
                        }}
                      >
                        {item.text.replace(/ /g, '').split('').map((char, slotIdx) => (
                          <div
                            key={slotIdx}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              minWidth: '24px',
                            }}
                          >
                            <span style={{ fontSize: '0.75rem', color: '#666' }}>{slotIdx + 1}</span>
                            <strong
                              style={{ fontSize: '1.1rem', color: char === '-' ? '#999' : '#000' }}
                            >
                              {char}
                            </strong>
                          </div>
                        ))}
                        {item.text.replace(/ /g, '').length === 0 && (
                          <span style={{ fontSize: '0.8rem', color: '#666' }}>
                            텍스트를 입력하면 음표 번호가 표시됩니다.
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>

            <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={submitReview} style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', background: '#1976d2', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                {pipelineMode === 'font_separator' ? '병합 후 OMR 실행' : 'OMR 실행 (악보 인식 시작)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {partLabelsJobId &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100004,
              padding: '2vh 2vw',
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="성부 라벨 지정"
              style={{
                background: '#fff',
                padding: '1.5rem 2rem',
                borderRadius: '8px',
                maxWidth: 'min(720px, 96vw)',
                maxHeight: '90vh',
                overflow: 'auto',
                boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
              }}
            >
              <PartLabelsPanel
                jobId={partLabelsJobId}
                onSubmitted={() => setPartLabelsJobId(null)}
              />
            </div>
          </div>,
          document.body,
        )}

      {omrStaffReviewJobId &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100005,
              padding: '2vh 2vw',
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="OMR 페이지·성부 품질 검토"
              className="modal-light"
              style={{
                padding: '1.25rem 1.5rem',
                borderRadius: '8px',
                maxWidth: 'min(1680px, 98vw)',
                width: '100%',
                maxHeight: '94vh',
                overflow: 'auto',
                boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <OmrStaffReviewPanel
                jobId={omrStaffReviewJobId}
                onContinue={submitContinueOmrStaffReview}
                continuing={omrStaffContinueBusy}
              />
            </div>
          </div>,
          document.body,
        )}

      {audiverisReviewJobId &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100000,
              padding: '2vh 2vw',
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label={
                audiverisModalTab === 'inspect'
                  ? '마스킹·OMR 인식 점검'
                  : 'OMR 결과 보정'
              }
              style={{
                background: audiverisModalTab === 'inspect' ? '#1e222a' : '#fff',
                color: audiverisModalTab === 'inspect' ? '#e8eaed' : undefined,
                padding: '1.75rem',
                borderRadius: '8px',
                maxWidth: audiverisModalTab === 'inspect' ? '96vw' : '520px',
                width: audiverisModalTab === 'inspect' ? '96%' : '92%',
                maxHeight: '92vh',
                minHeight: audiverisModalTab === 'inspect' ? 'min(56vh, 92vh)' : undefined,
                overflow: audiverisModalTab === 'inspect' ? 'hidden' : 'auto',
                display: audiverisModalTab === 'inspect' ? 'flex' : 'block',
                flexDirection: audiverisModalTab === 'inspect' ? 'column' : undefined,
                boxShadow:
                  '0 0 0 1px rgba(255,255,255,0.08), 0 24px 64px rgba(0,0,0,0.55)',
                border: audiverisModalTab === 'inspect' ? '1px solid #3d4453' : undefined,
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
            <div
              style={{
                display: 'flex',
                gap: 8,
                marginBottom: '1rem',
                flexWrap: 'wrap',
                flexShrink: 0,
              }}
            >
              <button
                type="button"
                className={audiverisModalTab === 'adjust' ? '' : 'btn-muted'}
                onClick={() => setAudiverisModalTab('adjust')}
              >
                보정·이어하기
              </button>
              <button
                type="button"
                className={audiverisModalTab === 'inspect' ? '' : 'btn-muted'}
                onClick={() => setAudiverisModalTab('inspect')}
              >
                마스킹·인식 점검
              </button>
            </div>

            {audiverisModalTab === 'inspect' ? (
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <InspectPanelErrorBoundary onBack={() => setAudiverisModalTab('adjust')}>
                  <AudiverisInspectPanel
                    jobId={audiverisReviewJobId}
                    onClose={() => setAudiverisModalTab('adjust')}
                  />
                </InspectPanelErrorBoundary>
              </div>
            ) : (
              <>
                <h2 style={{ margin: '0 0 0.75rem' }}>OMR 결과 보정</h2>
                <p style={{ margin: '0 0 1rem', lineHeight: 1.55, color: '#444' }}>
                  인식된 악보를 들어보거나 악보 편집기로 연 뒤, <strong>음높이·음표</strong>를 정한 다음 이어가세요. MXL은 아래에서 받거나, MuseScore 등에서 고친 파일을 교체 업로드할 수 있습니다.
                </p>
                <p style={{ margin: '0 0 1rem', lineHeight: 1.55, color: '#444' }}>
                  <strong>조옮김(반음)</strong>은 <strong>곡 전체가 같은 간격</strong>으로만 밀린 경우(예: 통째로 한 옥타브)에 맞습니다. <strong>일부 마디·일부 성부만</strong> 틀리면 조옮김은 0으로 두고, 틀린 음만 편집기에서 고친 뒤 <strong>교체 MXL</strong>로 올리는 것이 맞습니다.
                </p>
                <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: '#666' }}>
                  이 작업을 마칠 때까지 서버의 변환은 잠시 멈춰 있습니다.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <a
                    href={`/api/raw-mxl/${audiverisReviewJobId}`}
                    download
                    style={{ color: '#1565c0', fontWeight: 600 }}
                  >
                    OMR 원본 MXL 다운로드
                  </a>
                  <div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      조옮김(반음, −24〜24)
                      <input
                        type="number"
                        min={-24}
                        max={24}
                        value={audiverisTranspose}
                        onChange={(e) => {
                          const n = parseInt(e.target.value, 10);
                          setAudiverisTranspose(Number.isFinite(n) ? Math.max(-24, Math.min(24, n)) : 0);
                        }}
                        style={{ width: '4rem', padding: '0.4rem' }}
                      />
                    </label>
                    <p style={{ fontSize: '0.82rem', color: '#666', margin: '6px 0 0', lineHeight: 1.45 }}>
                      위에서 설명한 대로 곡 전체에만 적용됩니다. 부분 오류는 교체 파일로 처리하세요.
                    </p>
                  </div>
                  <div>
                    <div style={{ marginBottom: '6px', fontSize: '0.9rem' }}>교체 MXL (선택)</div>
                    <input
                      ref={audiverisReplaceRef}
                      type="file"
                      accept=".mxl,.xml,.musicxml,application/vnd.recordare.musicxml+xml,application/xml,text/xml"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void submitContinueAudiveris()}
                    style={{
                      marginTop: '0.5rem',
                      padding: '0.65rem 1.25rem',
                      fontSize: '1rem',
                      background: '#2e7d32',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    이어하기 (OCR·가사 주입)
                  </button>
                </div>
              </>
            )}
            </div>
          </div>,
          document.body,
        )}

      {inspectJobId &&
        createPortal(
          <div
            role="presentation"
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100010,
              padding: '2vh 2vw',
            }}
            onMouseDown={() => setInspectJobId(null)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="마스킹·OMR 인식 점검"
              style={{
                background: '#1e222a',
                color: '#e8eaed',
                padding: '1.25rem',
                borderRadius: '12px',
                maxWidth: 'min(1200px, 96vw)',
                width: '100%',
                maxHeight: '96vh',
                overflow: 'auto',
                border: '1px solid #3d4453',
                boxShadow: '0 0 0 1px rgba(255,255,255,0.08), 0 24px 64px rgba(0,0,0,0.55)',
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <InspectPanelErrorBoundary onBack={() => setInspectJobId(null)}>
                <AudiverisInspectPanel jobId={inspectJobId} onClose={() => setInspectJobId(null)} />
              </InspectPanelErrorBoundary>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
