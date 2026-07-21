import archiver from 'archiver';
import busboy from 'busboy';
import cors from 'cors';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execCallback);

/** fix_audiveris_mxl — 리듬 duration 변경은 기본 off(OMR 유지). */
function pythonMxlFixEnv(sessionRoot?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OMR_ENGINE: process.env.OMR_ENGINE?.trim() || 'audiveris',
    AI_OMR_BACKEND: process.env.AI_OMR_BACKEND?.trim() || 'homr',
    AUDIVERIS_MXL_RHYTHM_FIX: process.env.AUDIVERIS_MXL_RHYTHM_FIX ?? 'off',
  };
  if (sessionRoot) {
    const manifestPath = sessionLyricManifestPath(sessionRoot);
    if (fsSync.existsSync(manifestPath)) {
      env.PDF2MXL_LYRIC_MANIFEST = manifestPath;
    }
    env.MXL_MEASURE_OFFSET_PRINTED = String(
      Number(process.env.MXL_MEASURE_OFFSET_PRINTED ?? '1') || 1,
    );
  }
  return env;
}

import {
  AUDIVERIS_SHEET_STEPS,
  audiverisExtraCliArgsFromEnv,
  audiverisCleanScoreConstantArgsFromEnv,
  audiverisLogSuggestsHumanReview,
  audiverisTextEngineConstantArgsFromEnv,
  buildAudiverisStepProbeArgv,
  collectMusicXmlOutputs,
  isAudiverisSheetStep,
  ocrLanguageConstantArgsFromEnv,
  parseAudiverisSheetsSpec,
  resolvedAudiverisOcrLangSpec,
  resolveAudiverisBin,
  runAudiveris,
  runAudiverisArgv,
} from '../shared/audiveris.js';
import {
  omrEngineConfigured,
  p2mpInstallHint,
  resolveOmrEngine,
  resolveP2mpBin,
  runOmrEngine,
} from '../shared/omr.js';
import {
  parsePrintedMeasureMarkersFromManifest,
  type PrintedMeasureMarker,
} from '../shared/printedMeasureNumbers.js';

const PORT = Number(process.env.PORT || 8787);

/** 완료·실패 처리 시점부터 이 시간이 지나면 작업 레코드와(필요 시) 임시 파일을 삭제합니다. */
const JOB_RETENTION_MS = 24 * 60 * 60 * 1000;
const JOB_RETENTION_HOURS = JOB_RETENTION_MS / (60 * 60 * 1000);
const PURGE_INTERVAL_MS = 15 * 60 * 1000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');

const app = express();
app.use(cors({ origin: true }));

const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;

function decodeMultipartFilename(name: string): string {
  const raw = (name || 'input.pdf').trim() || 'input.pdf';
  const nfc = (s: string) => s.normalize('NFC');
  const hasHangul = (s: string) => /[\uAC00-\uD7A3]/.test(s);
  const hasReplacement = (s: string) => /[\uFFFD]/.test(s);
  const fromLatin = Buffer.from(raw, 'latin1').toString('utf8');

  if (hasHangul(raw) && !hasReplacement(raw)) return nfc(raw);
  if (hasHangul(fromLatin) && !hasReplacement(fromLatin)) return nfc(fromLatin);
  if (raw !== fromLatin && hasHangul(fromLatin)) return nfc(fromLatin);
  return nfc(fromLatin);
}

function safeUploadBasename(originalHeaderName: string): string {
  const decoded = decodeMultipartFilename(originalHeaderName);
  const safe = path.basename(decoded).replace(/[^\w.\-\uAC00-\uD7A3\s]+/g, '_');
  return safe || 'input.pdf';
}

const GENERIC_PDF_BASENAMES = new Set([
  'input.pdf',
  'upload_clean_score.pdf',
  'clean_score_only.pdf',
  'original.pdf',
  'masked_input.pdf',
]);

function isGenericPdfBasename(name: string): boolean {
  return GENERIC_PDF_BASENAMES.has(path.basename(name).trim().toLowerCase());
}

function sessionSourcePdfDisplayNamePath(sessionRoot: string): string {
  return path.join(sessionRoot, 'source_pdf_display_name.txt');
}

async function persistSourcePdfDisplayName(sessionRoot: string, displayName: string): Promise<void> {
  const trimmed = displayName.trim();
  if (!trimmed || isGenericPdfBasename(trimmed)) return;
  await fs.writeFile(sessionSourcePdfDisplayNamePath(sessionRoot), trimmed, 'utf8');
}

function readSourcePdfDisplayNameSync(sessionRoot: string): string | null {
  const p = sessionSourcePdfDisplayNamePath(sessionRoot);
  if (!fsSync.existsSync(p)) return null;
  try {
    const v = fsSync.readFileSync(p, 'utf8').trim();
    return v && !isGenericPdfBasename(v) ? v : null;
  } catch {
    return null;
  }
}

function deriveDownloadBaseFromFilename(filename: string): string {
  let base = path.basename(filename, path.extname(filename)).trim();
  base = base.replace(/-clean-?score-?only$/i, '').trim();
  return base || 'score';
}

function audiverisPauseOnWarnFromEnv(): boolean {
  const v = process.env.AUDIVERIS_PAUSE_ON_WARN?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function resolvePythonBin(): string {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
  const venvPython = path.join(__dirname, '..', '.venv', 'bin', 'python');
  if (fsSync.existsSync(venvPython)) return venvPython;
  const venvPython2 = path.join(__dirname, '..', 'venv', 'bin', 'python');
  if (fsSync.existsSync(venvPython2)) return venvPython2;
  const venvWinPython = path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe');
  if (fsSync.existsSync(venvWinPython)) return venvWinPython;
  const venvWinPython2 = path.join(__dirname, '..', 'venv', 'Scripts', 'python.exe');
  if (fsSync.existsSync(venvWinPython2)) return venvWinPython2;
  return 'python'; // fallback to global
}

const FONT_SEPARATOR_PY_MODULES = ['pikepdf', 'pdfplumber'] as const;

function fontSeparatorDepsInstallHint(pythonBin: string): string {
  return `"${pythonBin}" -m pip install -r requirements.txt` +
    ' (또는 pip install pikepdf pdfplumber). Linux에서 pikepdf 빌드 실패 시 libqpdf-dev 등 QPDF 개발 패키지가 필요할 수 있습니다.';
}

/** font_separator 파이프라인용 pdfplumber·pikepdf import 가능 여부 */
async function probeFontSeparatorDeps(pythonBin: string): Promise<{
  ok: boolean;
  pythonBin: string;
  missing: string[];
  probeExecutable?: string;
  probeError?: string;
}> {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'probe_font_separator_deps.py');
  try {
    const { stdout, stderr } = await exec(`"${pythonBin}" "${scriptPath}"`, {
      maxBuffer: 256 * 1024,
    });
    if (stderr?.trim()) {
      console.warn('[health] probe_font_separator_deps stderr:', stderr.trim());
    }
    const parsed = JSON.parse(String(stdout).trim()) as {
      ok?: boolean;
      missing?: unknown;
      executable?: string;
    };
    const missing = Array.isArray(parsed.missing)
      ? parsed.missing.filter((m): m is string => typeof m === 'string')
      : [];
    const executable =
      typeof parsed.executable === 'string' && parsed.executable ? parsed.executable : pythonBin;
    return {
      ok: parsed.ok === true || missing.length === 0,
      pythonBin: executable,
      missing,
      probeExecutable: executable,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      pythonBin,
      missing: [...FONT_SEPARATOR_PY_MODULES],
      probeError: msg,
    };
  }
}

function isMissingPythonModuleError(msg: string, module: string): boolean {
  return (
    msg.includes(`No module named '${module}'`) ||
    msg.includes(`No module named "${module}"`) ||
    msg.includes(`ModuleNotFoundError: No module named ${module}`)
  );
}

function formatFontSeparatorDepsError(depCheck: { missing: string[]; pythonBin: string }): JobErrorPayload {
  return {
    status: 503,
    error: '폰트 분리 파이프라인 Python 패키지가 설치되어 있지 않습니다',
    detail: `누락 모듈: ${depCheck.missing.join(', ')}. Python: ${depCheck.pythonBin}. 설치: ${fontSeparatorDepsInstallHint(depCheck.pythonBin)}`,
  };
}

async function probeAiOmrDeps(pythonBin: string): Promise<{
  ok: boolean;
  backend: string;
  missing: string[];
  torchOk: boolean;
  cudaAvailable: boolean;
  probeExecutable?: string;
  probeError?: string;
  hint?: string;
}> {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'probe_ai_omr_deps.py');
  try {
    const { stdout, stderr } = await exec(`"${pythonBin}" "${scriptPath}"`, {
      maxBuffer: 256 * 1024,
      env: { ...process.env },
    });
    if (stderr?.trim()) {
      console.warn('[health] probe_ai_omr_deps stderr:', stderr.trim());
    }
    const parsed = JSON.parse(String(stdout).trim()) as {
      ok?: boolean;
      missing?: unknown;
      backend?: string;
      torchOk?: boolean;
      cudaAvailable?: boolean;
      executable?: string;
      hint?: string;
    };
    const missing = Array.isArray(parsed.missing)
      ? parsed.missing.filter((m): m is string => typeof m === 'string')
      : [];
    return {
      ok: parsed.ok === true,
      backend: typeof parsed.backend === 'string' ? parsed.backend : 'homr',
      missing,
      torchOk: parsed.torchOk === true,
      cudaAvailable: parsed.cudaAvailable === true,
      probeExecutable:
        typeof parsed.executable === 'string' && parsed.executable ? parsed.executable : pythonBin,
      hint: typeof parsed.hint === 'string' ? parsed.hint : undefined,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      backend: process.env.AI_OMR_BACKEND?.trim() || 'homr',
      missing: ['PyMuPDF'],
      torchOk: false,
      cudaAvailable: false,
      probeError: msg,
    };
  }
}

async function probePdfToMusicDeps(): Promise<{
  ok: boolean;
  p2mpBin?: string;
  probeError?: string;
  hint?: string;
}> {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'probe_pdftomusic_deps.py');
  const pythonBin = resolvePythonBin();
  try {
    const { stdout, stderr } = await exec(`"${pythonBin}" "${scriptPath}"`, {
      maxBuffer: 256 * 1024,
      env: { ...process.env },
    });
    if (stderr?.trim()) {
      console.warn('[health] probe_pdftomusic_deps stderr:', stderr.trim());
    }
    const parsed = JSON.parse(String(stdout).trim()) as {
      ok?: boolean;
      p2mpBin?: string;
      hint?: string;
      probeError?: string;
    };
    return {
      ok: parsed.ok === true,
      p2mpBin: parsed.p2mpBin,
      hint: parsed.hint,
      probeError: parsed.probeError,
    };
  } catch (e) {
    const bin = resolveP2mpBin();
    return {
      ok: Boolean(bin),
      p2mpBin: bin,
      probeError: e instanceof Error ? e.message : String(e),
      hint: p2mpInstallHint(),
    };
  }
}

app.get('/api/health', async (_req, res) => {
  const bin = resolveAudiverisBin();
  const omr = omrEngineConfigured();
  const ocrLangEffective = resolvedAudiverisOcrLangSpec();
  const ocrLangConstantInjected = ocrLanguageConstantArgsFromEnv().length > 0;
  const extraCli = audiverisExtraCliArgsFromEnv();
  const pythonBin = resolvePythonBin();
  const sepDeps = await probeFontSeparatorDeps(pythonBin);
  const aiDeps = await probeAiOmrDeps(pythonBin);
  const p2mDeps = await probePdfToMusicDeps();
  const omrEngineReady =
    omr.engine === 'ai'
      ? aiDeps.ok
      : omr.engine === 'pdftomusic'
        ? p2mDeps.ok
        : Boolean(bin);
  res.json({
    ok: true,
    omrEngine: omr.engine,
    omrEngineReady,
    omrEngineDetail:
      omr.engine === 'ai'
        ? aiDeps.ok
          ? `AI OMR backend=${aiDeps.backend}${aiDeps.cudaAvailable ? ' (CUDA)' : ''}`
          : aiDeps.hint || `AI OMR deps missing: ${aiDeps.missing.join(', ')}`
        : omr.engine === 'pdftomusic'
          ? p2mDeps.ok
            ? `PDFtoMusic Pro (${p2mDeps.p2mpBin ?? resolveP2mpBin()})`
            : p2mDeps.hint || p2mpInstallHint()
          : omr.detail,
    pdftomusicConfigured: p2mDeps.ok,
    pdftomusicBin: p2mDeps.p2mpBin ?? resolveP2mpBin() ?? undefined,
    pdftomusicDepsHint: p2mDeps.ok ? undefined : p2mDeps.hint || p2mpInstallHint(),
    pdftomusicProbeError: p2mDeps.probeError,
    aiOmrBackend: aiDeps.backend,
    aiOmrDepsOk: aiDeps.ok,
    aiOmrTorchOk: aiDeps.torchOk,
    aiOmrCudaAvailable: aiDeps.cudaAvailable,
    aiOmrMissingModules: aiDeps.missing.length ? aiDeps.missing : undefined,
    aiOmrDepsHint: aiDeps.ok ? undefined : aiDeps.hint,
    aiOmrProbeError: aiDeps.probeError,
    audiverisOcrLangEffective: ocrLangEffective,
    audiverisOcrLangConstantInjected: ocrLangConstantInjected,
    audiverisCliExtraArgCount: extraCli.length,
    audiverisPauseOnWarn: audiverisPauseOnWarnFromEnv(),
    audiverisWarnPattern: process.env.AUDIVERIS_WARN_PATTERN?.trim() || null,
    fontSeparatorDepsOk: sepDeps.ok,
    fontSeparatorPythonBin: sepDeps.pythonBin,
    fontSeparatorProbeExecutable: sepDeps.probeExecutable,
    fontSeparatorMissingModules: sepDeps.missing.length ? sepDeps.missing : undefined,
    fontSeparatorDepsHint: sepDeps.ok ? undefined : fontSeparatorDepsInstallHint(sepDeps.pythonBin),
    fontSeparatorProbeError: sepDeps.probeError,
    hint: omrEngineReady
      ? undefined
      : omr.engine === 'ai'
        ? aiDeps.hint || `AI OMR deps: ${aiDeps.missing.join(', ')}`
        : omr.engine === 'pdftomusic'
          ? p2mDeps.hint || p2mpInstallHint()
          : omr.detail || 'Set AUDIVERIS_BIN (OMR_ENGINE=audiveris)',
    audiverisConfigured: Boolean(bin),
    audiverisLegacyEngine: omr.engine === 'audiveris',
    jobRetentionHours: JOB_RETENTION_HOURS,
    jobRetentionNote:
      '변환 완료 또는 실패 처리 후 서버에 보관되는 작업·파일은 24시간이 지나면 자동으로 삭제됩니다. 완료 직후 다운로드를 받아도 같은 jobId로 마스킹·인식 점검 API는 TTL 전까지 사용할 수 있습니다.',
  });
});

/** Audiveris 공식 시트 단계 이름 목록 (단계별 디버깅 UI·도구용). */
app.get('/api/audiveris-sheet-steps', (_req, res) => {
  res.json({ steps: [...AUDIVERIS_SHEET_STEPS] });
});

type JobStatus =
  | 'pending'
  | 'processing'
  | 'font_strip_needed'
  | 'clean_score_preview_needed'
  | 'lyric_manifest_save_needed'
  | 'review_needed'
  | 'part_labels_needed'
  | 'omr_staff_review_needed'
  | 'audiveris_review_needed'
  | 'completed'
  | 'failed';

type JobProgressPhase = 'upload' | 'separator' | 'audiveris' | 'hitl';

type PipelineMode = 'audiveris_only' | 'pymupdf_review' | 'font_separator';

/** 같은 PDF 반복 작업 시 중간 단계부터 시작 */
type StartStage = 'full' | 'clean_score' | 'omr_hitl' | 'lyric_inject';

type JobProgress = {
  phase: JobProgressPhase;
  current: number;
  total: number;
  detail?: string;
};

type JobResult =
  | {
      kind: 'single';
      filePath: string;
      downloadBaseName: string;
      ext: string;
    }
  | {
      kind: 'zip';
      finalOutputs: string[];
      isDebug: boolean;
      /** 디버그 ZIP에 업로드 원본 PDF를 포함할 때 */
      uploadedPdfPath?: string;
      uploadedPdfZipName?: string;
      zipName: string;
    };

type JobErrorPayload = {
  status: number;
  error: string;
  detail?: string;
  exitCode?: number;
  stdoutTail?: string;
  stderrTail?: string;
};

type JobRecord = {
  status: JobStatus;
  sessionRoot: string;
  originalName: string;
  /** 업로드가 끝나면 설정되며, 그 후 executeJob이 실행됩니다. */
  inputPdfPath?: string;
  isDebug: boolean;
  createdAt: number;
  /** 변환이 끝난 시점(성공 또는 최종 실패 판정). TTL 기준. */
  finishedAt?: number;
  error?: JobErrorPayload;
  result?: JobResult;
  /** UI·폴링용 진행률 (업로드, Audiveris 단계) */
  progress?: JobProgress;
  /** Audiveris 로그에서 추출한 전체 페이지/장 수 힌트 */
  pdfPageCount?: number;
  reviewDeferred?: { resolve: () => void; reject: (err: Error) => void };
  reviewData?: any;
  /** font_separator: OMR·HITL 이후 가사 검증 UI (원본 PDF 미리보기) */
  reviewAfterOmr?: boolean;
  /** OMR·HITL 후 가사 검증 — manifest·1단계 편집 유지(초기 추출로 덮지 않음) */
  reviewPreservesEdits?: boolean;
  /** omr-work.zip에서 가져온 가사 검증 JSON이 세션에 있음 */
  hasSavedLyricReview?: boolean;
  /** Audiveris 직후 보정 단계용 */
  pauseAfterAudiveris?: boolean;
  preInjectMxlPaths?: string[];
  audiverisReviewDeferred?: { resolve: () => void; reject: (err: Error) => void };
  injectMxlPathsOverride?: string[];
  /** 변환 파이프라인: 폰트 분리(권장) · PyMuPDF 마스킹 · Audiveris만 */
  pipelineMode?: PipelineMode;
  /** font_separator 모드에서 PyMuPDF 가사 검증 UI 사용 */
  enablePymupdfReview?: boolean;
  /** Audiveris 직후 페이지×staff MXL lint HITL (기본 켜짐) */
  enableOmrStaffReview?: boolean;
  /** full=원본 PDF, clean_score=clean_score+가사, omr_hitl=ZIP+가사, lyric_inject=ZIP(MXL)+가사 JSON */
  startStage?: StartStage;
  resumeCleanScorePath?: string;
  resumeLyricManifestPath?: string;
  resumeOmrWorkZipPath?: string;
  resumeCorrectedMxlPath?: string;
  omrStaffReviewDeferred?: { resolve: () => void; reject: (err: Error) => void };
  partLabelsDeferred?: { resolve: () => void; reject: (err: Error) => void };
  /** 성부 라벨 확정 직후 메모리 보관(파일 읽기 실패 시 lint relabel용) */
  partLabelsByIndex?: string[];
  fontStripDeferred?: { resolve: () => void; reject: (err: Error) => void };
  fontStripStats?: Record<string, unknown>;
  cleanScorePreviewDeferred?: { resolve: () => void; reject: (err: Error) => void };
  cleanScorePreviewAction?: 'continue' | 'redo_font_strip';
  lyricManifestSaveDeferred?: { resolve: () => void; reject: (err: Error) => void };
  /** 사용자 업로드 원본 PDF 표시 이름(MXL·ZIP 다운로드 기본값) */
  sourcePdfDisplayName?: string;
};

function rememberSourcePdfDisplayName(job: JobRecord, displayName: string): void {
  const trimmed = displayName.trim();
  if (!trimmed || isGenericPdfBasename(trimmed)) return;
  job.sourcePdfDisplayName = trimmed;
  void persistSourcePdfDisplayName(job.sessionRoot, trimmed);
}

function resolveDownloadBaseName(job: JobRecord): string {
  for (const c of [
    job.sourcePdfDisplayName,
    readSourcePdfDisplayNameSync(job.sessionRoot),
    isGenericPdfBasename(job.originalName) ? null : job.originalName,
  ]) {
    if (c?.trim() && !isGenericPdfBasename(c)) {
      return deriveDownloadBaseFromFilename(c);
    }
  }
  return 'score';
}

const jobs = new Map<string, JobRecord>();

function purgeExpiredJobs(): void {
  const now = Date.now();
  for (const [jobId, job] of jobs) {
    if (job.status !== 'completed' && job.status !== 'failed') continue;
    const finishedAt = job.finishedAt;
    if (finishedAt === undefined || now - finishedAt < JOB_RETENTION_MS) continue;
    jobs.delete(jobId);
    if (job.status === 'completed') {
      void fs.rm(job.sessionRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function noCacheJson(res: express.Response): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
}

function setJobProgress(job: JobRecord | undefined, p: JobProgress): void {
  if (!job || job.status === 'failed' || job.status === 'completed') return;
  job.progress = p;
  if (p.phase === 'audiveris' && p.total > 0) job.pdfPageCount = p.total;
}

const JOB_STATUSES_WITH_PROGRESS: ReadonlySet<JobStatus> = new Set([
  'pending',
  'processing',
  'font_strip_needed',
  'clean_score_preview_needed',
  'lyric_manifest_save_needed',
  'review_needed',
  'part_labels_needed',
  'omr_staff_review_needed',
  'audiveris_review_needed',
]);

function cleanScorePreviewJobsAllowed(job: JobRecord | undefined): job is JobRecord {
  return Boolean(job && job.status === 'clean_score_preview_needed');
}

function lyricManifestSaveJobsAllowed(job: JobRecord | undefined): job is JobRecord {
  return Boolean(job && job.status === 'lyric_manifest_save_needed');
}

function sessionLyricManifestPath(sessionRoot: string): string {
  return path.join(sessionRoot, 'lyric_manifest.json');
}

function lyricManifestDownloadBaseName(job: JobRecord): string {
  return `${resolveDownloadBaseName(job)}-lyric_manifest.json`;
}

function lyricManifestDownloadJobsAllowed(job: JobRecord | undefined): job is JobRecord {
  if (!job) return false;
  if (!fsSync.existsSync(sessionLyricManifestPath(job.sessionRoot))) return false;
  return (
    job.status === 'lyric_manifest_save_needed' ||
    job.status === 'processing' ||
    job.status === 'review_needed' ||
    job.status === 'part_labels_needed' ||
    job.status === 'omr_staff_review_needed' ||
    job.status === 'audiveris_review_needed' ||
    job.status === 'completed' ||
    job.status === 'failed'
  );
}

async function readPrintedMeasureMarkersFromSession(
  sessionRoot: string,
  measureOffsetPrinted: number,
): Promise<PrintedMeasureMarker[]> {
  const manifestPath = sessionLyricManifestPath(sessionRoot);
  if (!fsSync.existsSync(manifestPath)) return [];
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as { items?: unknown[] };
    return parsePrintedMeasureMarkersFromManifest(manifest, measureOffsetPrinted);
  } catch {
    return [];
  }
}

async function readLyricManifestSummary(sessionRoot: string): Promise<{
  itemCount: number;
  matchStats: Record<string, unknown> | null;
  version: number;
} | null> {
  const manifestPath = sessionLyricManifestPath(sessionRoot);
  if (!fsSync.existsSync(manifestPath)) return null;
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    const items = Array.isArray(manifest.items) ? manifest.items : [];
    const matchStats =
      manifest.matchStats && typeof manifest.matchStats === 'object' ?
        (manifest.matchStats as Record<string, unknown>)
      : null;
    const version = typeof manifest.version === 'number' ? manifest.version : 3;
    return { itemCount: items.length, matchStats, version };
  } catch {
    return null;
  }
}

function diagnosticJobsAllowed(job: JobRecord | undefined): job is JobRecord {
  return Boolean(
    job &&
      (job.status === 'completed' ||
        job.status === 'part_labels_needed' ||
        job.status === 'omr_staff_review_needed' ||
        job.status === 'audiveris_review_needed' ||
        job.status === 'lyric_manifest_save_needed' ||
        job.status === 'failed'),
  );
}

function sessionPartLabelsPath(sessionRoot: string): string {
  return path.join(sessionRoot, 'part_labels.json');
}

function sessionPartLabelsPresetPath(sessionRoot: string): string {
  return path.join(sessionRoot, 'part_labels_preset.json');
}

function sessionMxlLintPath(sessionRoot: string): string {
  return path.join(sessionRoot, 'mxl_lint.json');
}

function sessionOmrHitlFixesPath(sessionRoot: string): string {
  return path.join(sessionRoot, 'omr_hitl_fixes.json');
}

function sessionAudiverisRawMxlPath(sessionRoot: string): string {
  return path.join(sessionRoot, 'audiveris_raw.mxl');
}

function sessionOmrHitlCheckpointPath(sessionRoot: string): string {
  return path.join(sessionRoot, 'omr_hitl_checkpoint.json');
}

function sessionHitlBaselineMxlPath(sessionRoot: string): string {
  return path.join(sessionRoot, 'omr_hitl_baseline.mxl');
}

async function readOmrHitlFixes(sessionRoot: string): Promise<unknown[]> {
  const fixesPath = sessionOmrHitlFixesPath(sessionRoot);
  if (!fsSync.existsSync(fixesPath)) return [];
  try {
    const raw = JSON.parse(await fs.readFile(fixesPath, 'utf8')) as { fixes?: unknown };
    return Array.isArray(raw.fixes) ? raw.fixes : [];
  } catch {
    return [];
  }
}

async function writeOmrHitlFixes(sessionRoot: string, fixes: unknown[]): Promise<void> {
  await fs.writeFile(
    sessionOmrHitlFixesPath(sessionRoot),
    JSON.stringify({ version: 1, fixes, savedAt: new Date().toISOString() }, null, 2),
    'utf8',
  );
}

async function saveHitlBaseline(sessionRoot: string, scorePath: string): Promise<void> {
  if (!fsSync.existsSync(scorePath)) return;
  await fs.copyFile(scorePath, sessionHitlBaselineMxlPath(sessionRoot));
}

async function runOmrHitlAutoNormalize(
  sessionRoot: string,
  scorePath: string,
  pythonBin: string,
): Promise<{
  restsFixed: number;
  measuresChanged: number;
  restDisplayCleared: number;
  tupletStaccatoRemoved: number;
  slursInjected: number;
  tupletShowNumberFixed: number;
  directionsRemoved: number;
  hitlApplied: number;
  hitlSkipped: number;
  pendingCleared: number;
}> {
  await ensureAudiverisRawBackup(scorePath, sessionRoot);
  const baselinePath = sessionHitlBaselineMxlPath(sessionRoot);
  const rawPath = sessionAudiverisRawMxlPath(sessionRoot);
  if (fsSync.existsSync(baselinePath)) {
    await fs.copyFile(baselinePath, scorePath);
  } else if (fsSync.existsSync(rawPath)) {
    await fs.copyFile(rawPath, scorePath);
  }
  const postStats = await postprocessAudiverisMxlInScoreFile(scorePath, pythonBin, sessionRoot);
  const fixes = await readOmrHitlFixes(sessionRoot);
  let hitlApplied = 0;
  let hitlSkipped = 0;
  let pendingCleared = 0;
  if (fixes.length > 0) {
    const hitlStats = (await applyOmrHitlFixesToScoreFile(sessionRoot, scorePath, pythonBin)) ?? {
      applied: 0,
      skipped: 0,
    };
    hitlApplied = hitlStats.applied;
    hitlSkipped = hitlStats.skipped;
    pendingCleared = fixes.length;
    await writeOmrHitlFixes(sessionRoot, []);
  }
  await saveHitlBaseline(sessionRoot, scorePath);
  return {
    ...postStats,
    hitlApplied,
    hitlSkipped,
    pendingCleared,
  };
}

async function ensureAudiverisRawBackup(scorePath: string, sessionRoot: string): Promise<void> {
  const rawPath = sessionAudiverisRawMxlPath(sessionRoot);
  if (fsSync.existsSync(rawPath)) return;
  if (!fsSync.existsSync(scorePath)) return;
  await fs.copyFile(scorePath, rawPath);
}

/** HITL·검토용 MXL을 세션 `audiveris_raw.mxl`과 동일하게 맞춤(후처리·baseline 오염 제거). */
async function restoreScoreFileFromAudiverisRaw(
  sessionRoot: string,
  scorePath: string,
): Promise<boolean> {
  const rawPath = sessionAudiverisRawMxlPath(sessionRoot);
  if (!fsSync.existsSync(rawPath) || !fsSync.existsSync(scorePath)) return false;
  await fs.copyFile(rawPath, scorePath);
  return true;
}

async function invalidateInspectScoreCache(sessionRoot: string): Promise<void> {
  const lintCache = sessionMxlLintPath(sessionRoot);
  if (fsSync.existsSync(lintCache)) await fs.unlink(lintCache).catch(() => {});
  const cacheDir = path.join(sessionRoot, '.diag-cache');
  const inspectXml = path.join(cacheDir, 'inspect-score.musicxml');
  if (fsSync.existsSync(inspectXml)) await fs.unlink(inspectXml).catch(() => {});
  const fixStamp = path.join(cacheDir, 'inspect-fix.stamp');
  if (fsSync.existsSync(fixStamp)) await fs.unlink(fixStamp).catch(() => {});
}

async function syncOmrReviewMxl(
  sessionRoot: string,
  scorePath: string,
  pythonBin: string,
): Promise<{
  restsFixed: number;
  measuresChanged: number;
  restDisplayCleared: number;
  tupletStaccatoRemoved: number;
  slursInjected: number;
  tupletShowNumberFixed: number;
  directionsRemoved: number;
  hitlApplied: number;
  hitlSkipped: number;
  pendingCleared: number;
  syncMode: 'full' | 'incremental' | 'restore' | 'restore-from-raw' | 'init';
  chordBeamMeasuresCleaned: number;
}> {
  await ensureAudiverisRawBackup(scorePath, sessionRoot);
  const rawPath = sessionAudiverisRawMxlPath(sessionRoot);
  const baselinePath = sessionHitlBaselineMxlPath(sessionRoot);
  const fixes = await readOmrHitlFixes(sessionRoot);
  const hasBaseline = fsSync.existsSync(baselinePath);
  const emptyPost = {
    restsFixed: 0,
    measuresChanged: 0,
    restDisplayCleared: 0,
    tupletStaccatoRemoved: 0,
    slursInjected: 0,
    tupletShowNumberFixed: 0,
    directionsRemoved: 0,
    chordBeamMeasuresCleaned: 0,
  };

  let syncMode: 'full' | 'incremental' | 'restore' | 'restore-from-raw' | 'init';
  let postStats = { ...emptyPost };
  let hitlApplied = 0;
  let hitlSkipped = 0;
  let pendingCleared = 0;

  if (!hasBaseline && fixes.length > 0) {
    syncMode = 'full';
    if (fsSync.existsSync(rawPath)) await fs.copyFile(rawPath, scorePath);
    const hitlStats = (await applyOmrHitlFixesToScoreFile(sessionRoot, scorePath, pythonBin)) ?? {
      applied: 0,
      skipped: 0,
    };
    hitlApplied = hitlStats.applied;
    hitlSkipped = hitlStats.skipped;
    pendingCleared = fixes.length;
    await saveHitlBaseline(sessionRoot, scorePath);
    await writeOmrHitlFixes(sessionRoot, []);
  } else if (hasBaseline && fixes.length > 0) {
    syncMode = 'incremental';
    await fs.copyFile(baselinePath, scorePath);
    const hitlStats = (await applyOmrHitlFixesToScoreFile(sessionRoot, scorePath, pythonBin)) ?? {
      applied: 0,
      skipped: 0,
    };
    hitlApplied = hitlStats.applied;
    hitlSkipped = hitlStats.skipped;
    pendingCleared = fixes.length;
    await saveHitlBaseline(sessionRoot, scorePath);
    await writeOmrHitlFixes(sessionRoot, []);
  } else if (hasBaseline) {
    syncMode = 'restore';
    let priorCheckpoint: { totalHitlApplied?: number } = {};
    try {
      priorCheckpoint = JSON.parse(
        await fs.readFile(sessionOmrHitlCheckpointPath(sessionRoot), 'utf8'),
      ) as { totalHitlApplied?: number };
    } catch {
      /* first restore */
    }
    const totalHitlApplied = priorCheckpoint.totalHitlApplied ?? 0;
    if (totalHitlApplied === 0 && fixes.length === 0 && fsSync.existsSync(rawPath)) {
      await fs.copyFile(rawPath, scorePath);
      await saveHitlBaseline(sessionRoot, scorePath);
      syncMode = 'restore-from-raw';
    } else {
      await fs.copyFile(baselinePath, scorePath);
    }
  } else {
    syncMode = 'init';
    if (fsSync.existsSync(rawPath)) await fs.copyFile(rawPath, scorePath);
    await saveHitlBaseline(sessionRoot, scorePath);
  }

  const chordBeamCleaned = await cleanupChordBeamsInScoreFile(scorePath, pythonBin);
  if (chordBeamCleaned > 0) {
    await saveHitlBaseline(sessionRoot, scorePath);
  }

  const checkpoint = {
    version: 2,
    rebuiltAt: new Date().toISOString(),
    syncMode,
    hitlApplied,
    hitlSkipped,
    pendingCleared,
    totalHitlApplied: (() => {
      let prior = 0;
      try {
        const prev = JSON.parse(
          fsSync.readFileSync(sessionOmrHitlCheckpointPath(sessionRoot), 'utf8'),
        ) as { totalHitlApplied?: number };
        prior = prev.totalHitlApplied ?? 0;
      } catch {
        /* none */
      }
      return prior + hitlApplied;
    })(),
  };
  await fs.writeFile(sessionOmrHitlCheckpointPath(sessionRoot), JSON.stringify(checkpoint, null, 2), 'utf8');
  return {
    ...postStats,
    hitlApplied,
    hitlSkipped,
    pendingCleared,
    syncMode,
    chordBeamMeasuresCleaned: Math.max(postStats.chordBeamMeasuresCleaned, chordBeamCleaned),
  };
}

/** @deprecated alias — syncOmrReviewMxl 사용 */
async function rebuildOmrReviewMxl(
  sessionRoot: string,
  scorePath: string,
  pythonBin: string,
): Promise<{
  restsFixed: number;
  measuresChanged: number;
  restDisplayCleared: number;
  tupletStaccatoRemoved: number;
  slursInjected: number;
  tupletShowNumberFixed: number;
  directionsRemoved: number;
  hitlApplied: number;
  hitlSkipped: number;
}> {
  const stats = await syncOmrReviewMxl(sessionRoot, scorePath, pythonBin);
  return {
    restsFixed: stats.restsFixed,
    measuresChanged: stats.measuresChanged,
    restDisplayCleared: stats.restDisplayCleared,
    tupletStaccatoRemoved: stats.tupletStaccatoRemoved,
    slursInjected: stats.slursInjected,
    tupletShowNumberFixed: stats.tupletShowNumberFixed,
    directionsRemoved: stats.directionsRemoved,
    hitlApplied: stats.hitlApplied,
    hitlSkipped: stats.hitlSkipped,
  };
}

function parseLabelsByIndexFile(raw: unknown): string[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const labelsByIndex = (raw as { labelsByIndex?: unknown }).labelsByIndex;
  if (!Array.isArray(labelsByIndex)) return null;
  const labels = labelsByIndex.map((x) => String(x ?? '').trim());
  return labels.length > 0 && labels.every((l) => l.length > 0) ? labels : null;
}

async function readLabelsByIndexFromPath(filePath: string): Promise<string[] | null> {
  if (!fsSync.existsSync(filePath)) return null;
  try {
    return parseLabelsByIndexFile(JSON.parse(await fs.readFile(filePath, 'utf8')));
  } catch {
    return null;
  }
}

async function resolvePartLabelsByIndex(
  sessionRoot: string,
  job?: JobRecord,
): Promise<string[] | null> {
  if (job?.partLabelsByIndex?.length && job.partLabelsByIndex.every((l) => l.trim())) {
    return job.partLabelsByIndex.map((x) => x.trim());
  }
  const saved = await readLabelsByIndexFromPath(sessionPartLabelsPath(sessionRoot));
  if (saved?.length) return saved;
  return readLabelsByIndexFromPath(sessionPartLabelsPresetPath(sessionRoot));
}

function resolvePartLabelsJsonPath(sessionRoot: string): string | null {
  const saved = sessionPartLabelsPath(sessionRoot);
  if (fsSync.existsSync(saved)) return saved;
  const preset = sessionPartLabelsPresetPath(sessionRoot);
  if (fsSync.existsSync(preset)) return preset;
  return null;
}

/** 문자 검토 초안만 있을 때 MXL·lint가 preset을 쓰도록 part_labels.json으로 복사 */
async function ensurePartLabelsJsonFromPreset(sessionRoot: string): Promise<string | null> {
  const savedPath = sessionPartLabelsPath(sessionRoot);
  if (fsSync.existsSync(savedPath)) return savedPath;
  const presetPath = sessionPartLabelsPresetPath(sessionRoot);
  if (!fsSync.existsSync(presetPath)) return null;
  const labels = await readLabelsByIndexFromPath(presetPath);
  if (!labels?.length) return null;
  const out = {
    version: 1,
    labelsByIndex: labels,
    savedAt: new Date().toISOString(),
    source: 'part_labels_preset',
  };
  await fs.writeFile(savedPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`part_labels: preset → part_labels.json (${labels.join(', ')})`);
  return savedPath;
}

function mxlLintNeedsRegeneration(sessionRoot: string): boolean {
  const lintPath = sessionMxlLintPath(sessionRoot);
  const labelsPath = sessionPartLabelsPath(sessionRoot);
  if (!fsSync.existsSync(lintPath)) return true;
  if (!fsSync.existsSync(labelsPath)) return false;
  try {
    const stLint = fsSync.statSync(lintPath);
    const stLabels = fsSync.statSync(labelsPath);
    return stLabels.mtimeMs > stLint.mtimeMs;
  } catch {
    return true;
  }
}

function relabelLintReportStaff(
  report: Record<string, unknown>,
  labelsByIndex: string[],
): Record<string, unknown> {
  if (!labelsByIndex.length) return report;

  const parts = report.parts as Array<{ id?: string; index?: number }> | undefined;
  const idToLabel = new Map<string, string>();
  parts?.forEach((p, i) => {
    const id = p.id;
    const idx = typeof p.index === 'number' && Number.isFinite(p.index) ? p.index : i;
    if (id && idx >= 0 && idx < labelsByIndex.length) idToLabel.set(id, labelsByIndex[idx]);
  });

  const labelFromPartToken = (token: string): string | undefined => {
    const m = /^P(\d+)$/i.exec(token.trim());
    if (!m) return undefined;
    const idx = Number.parseInt(m[1], 10) - 1;
    if (idx >= 0 && idx < labelsByIndex.length) return labelsByIndex[idx];
    return undefined;
  };

  const labelFromStaffToken = (staff: unknown): string | undefined => {
    if (typeof staff !== 'string') return undefined;
    return labelFromPartToken(staff);
  };

  const issues = Array.isArray(report.issues) ? [...report.issues] : [];
  const relabeled = issues.map((raw) => {
    if (!raw || typeof raw !== 'object') return raw;
    const iss = { ...(raw as Record<string, unknown>) };
    const pid = iss.partId;
    if (typeof pid === 'string') {
      if (idToLabel.has(pid)) {
        iss.staff = idToLabel.get(pid);
      } else {
        const fromId = labelFromPartToken(pid);
        if (fromId) iss.staff = fromId;
      }
    }
    if (typeof iss.staff === 'string' && /^P\d+$/i.test(iss.staff.trim())) {
      const fromToken = labelFromStaffToken(iss.staff);
      if (fromToken) iss.staff = fromToken;
    }
    return iss;
  });

  const byPageStaff: Record<string, number> = {};
  for (const raw of relabeled) {
    if (!raw || typeof raw !== 'object') continue;
    const iss = raw as { pageEstimate?: unknown; staff?: unknown };
    const key = `p${iss.pageEstimate ?? 1}:${iss.staff ?? '?'}`;
    byPageStaff[key] = (byPageStaff[key] ?? 0) + 1;
  }

  return {
    ...report,
    issues: relabeled,
    issueCount: relabeled.length,
    partLabelsByIndex: labelsByIndex,
    staffOrderHint: labelsByIndex,
    staffsInIssues: [
      ...new Set(
        relabeled
          .map((i) =>
            i && typeof i === 'object' ? (i as { staff?: unknown }).staff : undefined,
          )
          .filter((s): s is string => typeof s === 'string' && s.length > 0),
      ),
    ].sort(),
    byPageStaff: Object.entries(byPageStaff)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, count]) => ({ key, count })),
  };
}

/** 완료·보정 대기·실패 작업만 — 세션 폴더에 PDF가 남아 단계 디버깅을 돌릴 수 있는 경우 */
function audiverisStepProbeJobsAllowed(job: JobRecord | undefined): job is JobRecord {
  if (!job?.sessionRoot || !fsSync.existsSync(job.sessionRoot)) return false;
  return (
    job.status === 'completed' ||
    job.status === 'part_labels_needed' ||
    job.status === 'omr_staff_review_needed' ||
    job.status === 'audiveris_review_needed' ||
    job.status === 'failed'
  );
}

function artifactPathWithinRunRoot(runRoot: string, rel: string): string | null {
  const trimmed = rel.trim();
  if (!trimmed || trimmed.includes('\0')) return null;
  /* 리터럴 / … / 안에서 `/` 이스케이프가 esbuild에서 깨지므로 문자 클래스만 사용 */
  const normalizedRel = path.normalize(trimmed).replace(/^(\.\.[\\/])+/, '');
  const resolved = path.resolve(runRoot, normalizedRel);
  const rootResolved = path.resolve(runRoot);
  const relative = path.relative(rootResolved, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

async function collectAudiverisStepProbeArtifacts(
  runRoot: string,
): Promise<{ relPath: string; bytes: number }[]> {
  const out: { relPath: string; bytes: number }[] = [];
  async function walk(relDir: string): Promise<void> {
    const absDir = path.join(runRoot, relDir);
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
      const full = path.join(absDir, ent.name);
      if (ent.isDirectory()) await walk(rel);
      else {
        try {
          const st = await fs.stat(full);
          if (st.isFile()) out.push({ relPath: rel.replace(/\\/g, '/'), bytes: st.size });
        } catch {
          /* skip */
        }
      }
    }
  }
  await walk('');
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}

const AUDIVERIS_STEP_PROBE_CAPTURE_BYTES = 768 * 1024;

async function pdfPageCountViaPython(pdfPath: string): Promise<number | null> {
  if (!fsSync.existsSync(pdfPath)) return null;
  const script = path.join(__dirname, '..', 'scripts', 'pdf_diagnostic.py');
  const pythonBin = resolvePythonBin();
  try {
    const { stdout } = await exec(`"${pythonBin}" "${script}" info "${pdfPath}"`, {
      maxBuffer: 8 * 1024 * 1024,
    });
    const j = JSON.parse(String(stdout).trim()) as { pageCount?: unknown };
    return typeof j.pageCount === 'number' && j.pageCount >= 1 ? j.pageCount : null;
  } catch {
    return null;
  }
}

async function runMxlQualityLintForJob(
  job: JobRecord,
  mxlPath: string,
  pythonBin: string,
): Promise<Record<string, unknown>> {
  const script = path.join(__dirname, '..', 'scripts', 'mxl_quality_lint.py');
  const outJson = path.join(job.sessionRoot, 'mxl_lint.json');
  const pageCount = Math.max(
    1,
    job.pdfPageCount ??
      (await pdfPageCountViaPython(job.inputPdfPath ?? '')) ??
      1,
  );
  const offset = Number(process.env.MXL_MEASURE_OFFSET_PRINTED ?? '1') || 1;
  if (!fsSync.existsSync(script)) {
    throw new Error(`mxl_quality_lint.py 없음: ${script}`);
  }
  await ensurePartLabelsJsonFromPreset(job.sessionRoot);
  const labelsPath = resolvePartLabelsJsonPath(job.sessionRoot);
  const labelsArg = labelsPath ? ` --part-labels-json "${labelsPath}"` : '';
  try {
    await exec(
      `"${pythonBin}" "${script}" "${mxlPath}" --measure-offset ${offset} --page-count ${pageCount}${labelsArg} --json "${outJson}"`,
      { maxBuffer: 16 * 1024 * 1024 },
    );
  } catch (err) {
    const e = err as { message?: string; stderr?: string; stdout?: string };
    const tail = [e.stderr, e.stdout].filter(Boolean).join('\n').trim();
    throw new Error(
      tail ? `${e.message ?? 'mxl_quality_lint 실패'}\n${tail.slice(-1200)}` : (e.message ?? String(err)),
    );
  }
  if (!fsSync.existsSync(outJson)) {
    throw new Error('mxl_lint.json이 생성되지 않았습니다');
  }
  const raw = await fs.readFile(outJson, 'utf8');
  let report = JSON.parse(raw) as Record<string, unknown>;
  const labelsByIndex = await resolvePartLabelsByIndex(job.sessionRoot, job);
  if (labelsByIndex?.length) {
    report = relabelLintReportStaff(report, labelsByIndex);
    await fs.writeFile(outJson, JSON.stringify(report, null, 2), 'utf8');
  }
  return report;
}

async function listScorePartsFromMxl(
  mxlPath: string,
  pythonBin: string,
): Promise<{ parts: Array<Record<string, unknown>> }> {
  const script = path.join(__dirname, '..', 'scripts', 'mxl_quality_lint.py');
  const { stdout } = await exec(`"${pythonBin}" "${script}" "${mxlPath}" --list-parts`, {
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(String(stdout).trim()) as { parts: Array<Record<string, unknown>> };
}

function isScoreOutputPath(filePath: string): boolean {
  const low = filePath.toLowerCase();
  return low.endsWith('.mxl') || low.endsWith('.musicxml');
}

function collectScorePathsForLabeling(outputs: string[], extra: string[]): string[] {
  const seen = new Set<string>();
  for (const p of [...outputs, ...extra]) {
    if (isScoreOutputPath(p) && fsSync.existsSync(p)) seen.add(p);
  }
  return [...seen];
}

async function applyOmrHitlFixesToScoreFile(
  sessionRoot: string,
  scorePath: string,
  pythonBin: string,
): Promise<{ applied: number; skipped: number } | null> {
  const fixesPath = sessionOmrHitlFixesPath(sessionRoot);
  if (!fsSync.existsSync(fixesPath)) return null;
  const script = path.join(__dirname, '..', 'scripts', 'apply_omr_hitl_fixes.py');
  if (!fsSync.existsSync(script)) return null;
  try {
    const { stdout, stderr } = await exec(
      `"${pythonBin}" "${script}" "${scorePath}" --fixes-json "${fixesPath}"`,
      { maxBuffer: 8 * 1024 * 1024 },
    );
    const line = String(stdout).trim();
    if (stderr?.trim()) console.warn(`apply_omr_hitl_fixes stderr (${scorePath}): ${stderr.trim()}`);
    if (!line) return { applied: 0, skipped: 0 };
    const parsed = JSON.parse(line) as { applied?: number; skipped?: number };
    console.log(
      `apply_omr_hitl_fixes (${scorePath}): applied=${parsed.applied ?? 0} skipped=${parsed.skipped ?? 0}`,
    );
    return { applied: parsed.applied ?? 0, skipped: parsed.skipped ?? 0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`apply_omr_hitl_fixes failed (${scorePath}): ${msg}`);
    return null;
  }
}

async function cleanupChordBeamsInScoreFile(
  scorePath: string,
  pythonBin: string,
): Promise<number> {
  const script = path.join(__dirname, '..', 'scripts', 'cleanup_chord_beams_mxl.py');
  if (!fsSync.existsSync(script) || !fsSync.existsSync(scorePath)) return 0;
  try {
    const { stdout } = await exec(`"${pythonBin}" "${script}" "${scorePath}"`, {
      maxBuffer: 4 * 1024 * 1024,
    });
    const line = String(stdout).trim();
    if (!line) return 0;
    const parsed = JSON.parse(line) as { chordBeamMeasuresCleaned?: number };
    return parsed.chordBeamMeasuresCleaned ?? 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`cleanup_chord_beams_mxl failed (${scorePath}): ${msg}`);
    return 0;
  }
}

async function fixAudiverisMxlInScoreFile(
  scorePath: string,
  pythonBin: string,
  sessionRoot?: string,
): Promise<{
  slursInjected: number;
  tupletShowNumberFixed: number;
  tupletStaccatoRemoved: number;
  directionsRemoved: number;
} | null> {
  const script = path.join(__dirname, '..', 'scripts', 'fix_audiveris_mxl.py');
  if (!fsSync.existsSync(script) || !fsSync.existsSync(scorePath)) return null;
  try {
    const { stdout, stderr } = await exec(`"${pythonBin}" "${script}" "${scorePath}"`, {
      maxBuffer: 8 * 1024 * 1024,
      env: pythonMxlFixEnv(sessionRoot),
    });
    if (stderr?.trim()) console.warn(`fix_audiveris_mxl stderr (${scorePath}): ${stderr.trim()}`);
    const line = String(stdout).trim();
    if (!line) {
      return {
        slursInjected: 0,
        tupletShowNumberFixed: 0,
        tupletStaccatoRemoved: 0,
        directionsRemoved: 0,
      };
    }
    const parsed = JSON.parse(line) as {
      slurs_injected?: number;
      tuplet_show_number_fixed?: number;
      tuplet_staccato_removed?: number;
      directions_removed?: number;
    };
    console.log(
      `fix_audiveris_mxl (${scorePath}): slurs=${parsed.slurs_injected ?? 0} tupletShow=${parsed.tuplet_show_number_fixed ?? 0} tupletStaccato=${parsed.tuplet_staccato_removed ?? 0}`,
    );
    return {
      slursInjected: parsed.slurs_injected ?? 0,
      tupletShowNumberFixed: parsed.tuplet_show_number_fixed ?? 0,
      tupletStaccatoRemoved: parsed.tuplet_staccato_removed ?? 0,
      directionsRemoved: parsed.directions_removed ?? 0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`fix_audiveris_mxl failed (${scorePath}): ${msg}`);
    return null;
  }
}

async function postprocessAudiverisMxlInScoreFile(
  scorePath: string,
  pythonBin: string,
  sessionRoot?: string,
): Promise<{
  restsFixed: number;
  measuresChanged: number;
  restDisplayCleared: number;
  tupletStaccatoRemoved: number;
  slursInjected: number;
  tupletShowNumberFixed: number;
  directionsRemoved: number;
  chordBeamMeasuresCleaned: number;
}> {
  const restStats = (await normalizeOmrRestsInScoreFile(scorePath, pythonBin)) ?? {
    restsFixed: 0,
    measuresChanged: 0,
    restDisplayCleared: 0,
    tupletStaccatoRemoved: 0,
  };
  const fixStats = (await fixAudiverisMxlInScoreFile(scorePath, pythonBin, sessionRoot)) ?? {
    slursInjected: 0,
    tupletShowNumberFixed: 0,
    tupletStaccatoRemoved: 0,
    directionsRemoved: 0,
  };
  const chordBeamCleaned = await cleanupChordBeamsInScoreFile(scorePath, pythonBin);
  return {
    restsFixed: restStats.restsFixed,
    measuresChanged: restStats.measuresChanged,
    restDisplayCleared: restStats.restDisplayCleared,
    tupletStaccatoRemoved: restStats.tupletStaccatoRemoved + fixStats.tupletStaccatoRemoved,
    slursInjected: fixStats.slursInjected,
    tupletShowNumberFixed: fixStats.tupletShowNumberFixed,
    directionsRemoved: fixStats.directionsRemoved,
    chordBeamMeasuresCleaned: chordBeamCleaned,
  };
}

async function normalizeOmrRestsInScoreFile(
  scorePath: string,
  pythonBin: string,
): Promise<{
  restsFixed: number;
  measuresChanged: number;
  restDisplayCleared: number;
  tupletStaccatoRemoved: number;
} | null> {
  const script = path.join(__dirname, '..', 'scripts', 'normalize_omr_rests.py');
  if (!fsSync.existsSync(script) || !fsSync.existsSync(scorePath)) return null;
  try {
    const { stdout, stderr } = await exec(`"${pythonBin}" "${script}" "${scorePath}"`, {
      maxBuffer: 8 * 1024 * 1024,
    });
    if (stderr?.trim()) console.warn(`normalize_omr_rests stderr (${scorePath}): ${stderr.trim()}`);
    const line = String(stdout).trim();
    if (!line)
      return { restsFixed: 0, measuresChanged: 0, restDisplayCleared: 0, tupletStaccatoRemoved: 0 };
    const parsed = JSON.parse(line) as {
      restsFixed?: number;
      measuresChanged?: number;
      restDisplayCleared?: number;
      tupletStaccatoRemoved?: number;
    };
    console.log(
      `normalize_omr_rests (${scorePath}): restsFixed=${parsed.restsFixed ?? 0} measuresChanged=${parsed.measuresChanged ?? 0} restDisplayCleared=${parsed.restDisplayCleared ?? 0} tupletStaccatoRemoved=${parsed.tupletStaccatoRemoved ?? 0}`,
    );
    return {
      restsFixed: parsed.restsFixed ?? 0,
      measuresChanged: parsed.measuresChanged ?? 0,
      restDisplayCleared: parsed.restDisplayCleared ?? 0,
      tupletStaccatoRemoved: parsed.tupletStaccatoRemoved ?? 0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`normalize_omr_rests failed (${scorePath}): ${msg}`);
    return null;
  }
}

async function applyOmrHitlFixesForJob(job: JobRecord, pythonBin: string): Promise<void> {
  const paths = job.preInjectMxlPaths?.filter((p) => p && fsSync.existsSync(p)) ?? [];
  for (const p of paths) {
    await applyOmrHitlFixesToScoreFile(job.sessionRoot, p, pythonBin);
  }
  const lintCache = sessionMxlLintPath(job.sessionRoot);
  if (fsSync.existsSync(lintCache)) {
    await fs.unlink(lintCache).catch(() => {});
  }
  const inspectXml = path.join(job.sessionRoot, '.diag-cache', 'inspect-score.musicxml');
  if (fsSync.existsSync(inspectXml)) {
    await fs.unlink(inspectXml).catch(() => {});
  }
}

async function applyPartLabelsToScoreFile(
  sessionRoot: string,
  scorePath: string,
  pythonBin: string,
): Promise<void> {
  await ensurePartLabelsJsonFromPreset(sessionRoot);
  const labelsPath = resolvePartLabelsJsonPath(sessionRoot);
  if (!labelsPath) {
    console.warn(`apply_part_labels skipped (no labels): ${scorePath}`);
    return;
  }
  const script = path.join(__dirname, '..', 'scripts', 'apply_part_labels.py');
  if (!fsSync.existsSync(script)) return;
  try {
    const { stdout, stderr } = await exec(
      `"${pythonBin}" "${script}" "${scorePath}" "${scorePath}" --part-labels-json "${labelsPath}"`,
      { maxBuffer: 8 * 1024 * 1024 },
    );
    const line = String(stdout).trim();
    if (line) {
      console.log(`apply_part_labels: ${line}`);
      try {
        const parsed = JSON.parse(line) as { applied?: boolean; reason?: string; changed?: number };
        if (!parsed.applied) {
          console.warn(`apply_part_labels not applied for ${scorePath}: ${parsed.reason ?? 'unknown'}`);
        }
      } catch {
        /* ignore */
      }
    }
    if (stderr?.trim()) console.warn(`apply_part_labels stderr (${scorePath}): ${stderr.trim()}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`apply_part_labels failed (${scorePath}): ${msg}`);
  }
}

function resolvePrimaryMxlPathForInspect(job: JobRecord): string | null {
  // lyric review 단계에서도 (OMR 결과) MXL이 있을 수 있다: review.mxl / baseline / raw 순으로 사용
  if (job.status === 'review_needed') {
    const review = path.join(job.sessionRoot, 'review.mxl');
    if (fsSync.existsSync(review)) return review;
    const baseline = sessionHitlBaselineMxlPath(job.sessionRoot);
    if (fsSync.existsSync(baseline)) return baseline;
    const raw = sessionAudiverisRawMxlPath(job.sessionRoot);
    if (fsSync.existsSync(raw)) return raw;
  }
  if (
    (job.status === 'audiveris_review_needed' ||
      job.status === 'omr_staff_review_needed' ||
      job.status === 'part_labels_needed') &&
    job.preInjectMxlPaths?.length
  ) {
    const p = job.preInjectMxlPaths[0];
    if (p && fsSync.existsSync(p)) return p;
    return null;
  }
  if (job.status === 'completed' && job.result) {
    if (job.result.kind === 'single') {
      const p = job.result.filePath;
      const low = p.toLowerCase();
      if ((low.endsWith('.mxl') || low.endsWith('.musicxml')) && fsSync.existsSync(p)) return p;
      return null;
    }
    for (const p of job.result.finalOutputs) {
      if (!p) continue;
      if (p.toLowerCase().endsWith('.mxl') && fsSync.existsSync(p)) return p;
    }
  }
  return null;
}

function diagnosticPdfDownloadBaseName(
  job: JobRecord,
  kind: 'masked' | 'original' | 'clean_score',
): string {
  const base = resolveDownloadBaseName(job);
  if (kind === 'masked') return `${base}-masked-audiveris-input`;
  if (kind === 'clean_score') return `${base}-clean-score-only`;
  return `${base}-upload-original`;
}

function sessionCleanScorePdfPath(sessionRoot: string): string {
  return path.join(sessionRoot, 'clean_score_only.pdf');
}

function sessionOcrPymupdfReviewPath(sessionRoot: string): string {
  return path.join(sessionRoot, 'ocr_data_pymupdf.json');
}

/** omr-work.zip에 포함된 가사 검증 편집(이어하기용) */
function sessionOcrPymupdfSavedPath(sessionRoot: string): string {
  return path.join(sessionRoot, 'ocr_data_pymupdf_saved.json');
}

/** 원본 PDF 1차 추출 기준(제목·작곡·가사 전체) */
function sessionOcrPymupdfBaselinePath(sessionRoot: string): string {
  return path.join(sessionRoot, 'ocr_data_pymupdf_baseline.json');
}

function sessionMaskedPdfPath(sessionRoot: string): string {
  return path.join(sessionRoot, 'masked_input.pdf');
}

function sessionResumeCleanScoreUploadPath(sessionRoot: string): string {
  return path.join(sessionRoot, 'upload_clean_score.pdf');
}

function sessionResumeLyricManifestUploadPath(sessionRoot: string): string {
  return path.join(sessionRoot, 'upload_lyric_manifest.json');
}

function sessionResumeOmrWorkZipPath(sessionRoot: string): string {
  return path.join(sessionRoot, 'upload_omr_work.zip');
}

function sessionResumeCorrectedMxlPath(sessionRoot: string): string {
  return path.join(sessionRoot, 'upload_corrected_score.mxl');
}

function parseStartStage(raw: string): StartStage {
  const v = raw.trim().toLowerCase();
  if (v === 'lyric_review' || v === 'omr') return 'clean_score';
  if (v === 'lyric_review_only') return 'lyric_inject';
  if (v === 'full' || v === 'clean_score' || v === 'omr_hitl' || v === 'lyric_inject') return v;
  return 'full';
}

function lyricManifestHasItems(manifestPath: string): boolean {
  if (!fsSync.existsSync(manifestPath)) return false;
  try {
    const raw = JSON.parse(fsSync.readFileSync(manifestPath, 'utf8')) as {
      items?: unknown;
    };
    const items = raw.items ?? raw;
    return Array.isArray(items) && items.length > 0;
  } catch {
    return false;
  }
}

async function extractZipArchive(
  zipPath: string,
  destDir: string,
  pythonBin: string,
): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  const extractPy = path.join(destDir, '..', `_extract_${Date.now()}.py`);
  await fs.writeFile(
    extractPy,
    'import zipfile, sys\nzipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])\n',
    'utf8',
  );
  try {
    await exec(`"${pythonBin}" "${extractPy}" "${zipPath}" "${destDir}"`, {
      maxBuffer: 8 * 1024 * 1024,
    });
  } finally {
    await fs.unlink(extractPy).catch(() => {});
  }
}

async function preparePymupdfReviewFromManifest(
  lyricManifestPath: string,
  pymupdfReviewPath: string,
): Promise<void> {
  if (fsSync.existsSync(pymupdfReviewPath) || !fsSync.existsSync(lyricManifestPath)) return;
  try {
    const manifest = JSON.parse(await fs.readFile(lyricManifestPath, 'utf8')) as {
      items?: unknown[];
    };
    const items = Array.isArray(manifest.items)
      ? manifest.items
      : Array.isArray(manifest)
        ? (manifest as unknown[])
        : null;
    if (items && items.length > 0) {
      await fs.writeFile(pymupdfReviewPath, JSON.stringify(items, null, 2), 'utf8');
    }
  } catch {
    /* optional */
  }
}

const MANUAL_LYRIC_MASK_TYPE = '_manual_lyric_mask';

function reviewItemsHaveUserEdits(items: unknown[]): boolean {
  if (!Array.isArray(items) || items.length === 0) return false;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (o.type === MANUAL_LYRIC_MASK_TYPE) return true;
    const t = o.type;
    if (t === 'unknown' && o.reviewTypeUserSet === true) return true;
    if (t === 'measure_number' || t === 'page_number') continue;
    if (typeof t === 'string' && t && t !== 'lyrics') {
      return true;
    }
    if (typeof o.lyricPartIndex === 'number' && o.lyricPartIndex > 1) return true;
    if (typeof o.lyricVerseIndex === 'number' && o.lyricVerseIndex > 1) return true;
    if (typeof o.lyricSkipNotes === 'number' && o.lyricSkipNotes > 0) return true;
    const lv = o.lyricVoice;
    if (typeof lv === 'string' && lv.trim() && lv.trim() !== '1') return true;
    if (Array.isArray(o.manualRects) && o.manualRects.length > 0) return true;
  }
  return false;
}

/** 검토 UI 구분 기본값 — unknown(미분류 미선택)은 가사. 사용자가 고른 미분류만 유지 */
function applyReviewUiDefaultRoles(items: unknown[]): unknown[] {
  return items.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const o = { ...(item as Record<string, unknown>) };
    const t = o.type;
    if (
      t === MANUAL_LYRIC_MASK_TYPE ||
      t === 'measure_number' ||
      t === 'page_number' ||
      t === 'title' ||
      t === 'composer' ||
      t === 'lyricist' ||
      t === 'copyright' ||
      t === 'tempo'
    ) {
      return o;
    }
    if (t === 'unknown' && o.reviewTypeUserSet === true) {
      return o;
    }
    if (!t || t === '' || t === 'unknown') {
      o.type = 'lyrics';
    }
    return o;
  });
}

async function loadLyricReviewItemsFromManifest(manifestPath: string): Promise<unknown[] | null> {
  if (!fsSync.existsSync(manifestPath)) return null;
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as { items?: unknown[] };
    const items = Array.isArray(manifest.items)
      ? manifest.items
      : Array.isArray(manifest)
        ? (manifest as unknown[])
        : null;
    return items && items.length > 0 ? items : null;
  } catch {
    return null;
  }
}

/** manifest·1단계 편집분 — 역할·성부·bbox·수동 영역 유지 */
function applyEditedReviewShape(items: unknown[]): unknown[] {
  return items.map((item, i) => {
    if (!item || typeof item !== 'object') return item;
    const o = { ...(item as Record<string, unknown>) };
    if (typeof o.id !== 'string' || !o.id.trim()) {
      o.id = `lyric_review_${i + 1}`;
    }
    return o;
  });
}

async function restorePartLabelsFromManifest(
  sessionRoot: string,
  manifestPath: string,
): Promise<void> {
  if (!fsSync.existsSync(manifestPath)) return;
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
      partLabelsByIndex?: unknown;
    };
    if (!Array.isArray(manifest.partLabelsByIndex)) return;
    const labels = manifest.partLabelsByIndex
      .map((x) => String(x ?? '').trim())
      .filter((l) => l.length > 0);
    if (!labels.length) return;
    await fs.writeFile(
      sessionPartLabelsPresetPath(sessionRoot),
      JSON.stringify({ version: 1, labelsByIndex: labels }, null, 2),
      'utf8',
    );
  } catch {
    /* optional */
  }
}

async function attachPartLabelsToManifest(
  sessionRoot: string,
  manifestPath: string,
  job?: JobRecord,
): Promise<void> {
  if (!fsSync.existsSync(manifestPath)) return;
  const labels = await resolvePartLabelsByIndex(sessionRoot, job);
  if (!labels?.length) return;
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.partLabelsByIndex = labels;
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  } catch {
    /* optional */
  }
}

async function restoreLyricArtifactsFromExtractDir(
  sessionRoot: string,
  extractDir: string,
): Promise<boolean> {
  const pick = (name: string) => {
    const p = path.join(extractDir, name);
    return fsSync.existsSync(p) ? p : null;
  };
  let restored = false;
  const manifestSrc = pick('lyric_manifest.json');
  if (manifestSrc) {
    await fs.copyFile(manifestSrc, path.join(sessionRoot, 'lyric_manifest.json'));
    restored = true;
  }
  const fontStripSrc = pick('font_strip_config.json');
  if (fontStripSrc) {
    await fs.copyFile(fontStripSrc, fontStripConfigPath(sessionRoot));
  } else {
    await restoreFontStripConfigFromManifest(sessionRoot);
  }
  const pymupdfSrc = pick('ocr_data_pymupdf.json');
  if (pymupdfSrc) {
    await fs.copyFile(pymupdfSrc, sessionOcrPymupdfSavedPath(sessionRoot));
    restored = true;
  }
  const baselineSrc = pick('ocr_data_pymupdf_baseline.json');
  if (baselineSrc) {
    await fs.copyFile(baselineSrc, sessionOcrPymupdfBaselinePath(sessionRoot));
  }
  const activePymupdf = sessionOcrPymupdfReviewPath(sessionRoot);
  if (fsSync.existsSync(activePymupdf)) {
    await fs.unlink(activePymupdf).catch(() => {});
  }
  const extractedSrc = pick('extracted_music_text.json');
  if (extractedSrc) {
    await fs.copyFile(extractedSrc, path.join(sessionRoot, 'extracted_music_text.json'));
  }
  return restored;
}

async function restoreOmrWorkPdfsFromExtractDir(
  sessionRoot: string,
  extractDir: string,
  job?: JobRecord,
): Promise<{ hasCleanScore: boolean; hasInput: boolean }> {
  const pick = (name: string) => {
    const p = path.join(extractDir, name);
    return fsSync.existsSync(p) ? p : null;
  };
  const cleanSrc = pick('clean_score_only.pdf');
  const inputSrc = pick('input.pdf') ?? pick('original.pdf');
  const cleanDest = sessionCleanScorePdfPath(sessionRoot);
  let hasCleanScore = false;
  let hasInput = false;
  if (cleanSrc) {
    await fs.copyFile(cleanSrc, cleanDest);
    hasCleanScore = true;
  }
  const manifestSrc = pick('manifest.json');
  if (manifestSrc && job) {
    try {
      const manifest = JSON.parse(await fs.readFile(manifestSrc, 'utf8')) as {
        originalName?: string;
        sourcePdfDisplayName?: string;
      };
      if (manifest.sourcePdfDisplayName?.trim()) {
        rememberSourcePdfDisplayName(job, manifest.sourcePdfDisplayName);
      } else if (manifest.originalName?.trim() && !isGenericPdfBasename(manifest.originalName)) {
        rememberSourcePdfDisplayName(job, manifest.originalName);
      }
      if (manifest.originalName?.trim()) {
        job.originalName = manifest.originalName.trim();
      }
    } catch {
      /* optional */
    }
  }
  if (inputSrc) {
    const inputDest = path.join(sessionRoot, 'input.pdf');
    await fs.copyFile(inputSrc, inputDest);
    if (job) job.inputPdfPath = inputDest;
    hasInput = true;
  } else if (hasCleanScore && job) {
    job.inputPdfPath = cleanDest;
    hasInput = true;
  }
  return { hasCleanScore, hasInput };
}

type OmrWorkImportOptions = {
  /** 가사·PDF는 세션 산출물 유지, MXL·HITL 보정만 ZIP에서 가져옴 (1단계 + 기존 MXL) */
  mxlOnly?: boolean;
};

async function importOmrWorkFromExtractDir(
  sessionRoot: string,
  extractDir: string,
  scorePath: string,
  pythonBin: string,
  job?: JobRecord,
  options?: OmrWorkImportOptions,
): Promise<{ fixCount: number; stats: Awaited<ReturnType<typeof syncOmrReviewMxl>>; pdfRestored: boolean }> {
  const pick = (name: string) => {
    const p = path.join(extractDir, name);
    return fsSync.existsSync(p) ? p : null;
  };
  if (options?.mxlOnly) {
    const pymupdfSrc = pick('ocr_data_pymupdf.json');
    if (pymupdfSrc) {
      await fs.copyFile(pymupdfSrc, sessionOcrPymupdfSavedPath(sessionRoot));
      if (job) {
        try {
          const raw = JSON.parse(await fs.readFile(pymupdfSrc, 'utf8')) as unknown[];
          job.hasSavedLyricReview = Array.isArray(raw) && reviewItemsHaveUserEdits(raw);
        } catch {
          job.hasSavedLyricReview = false;
        }
      }
    }
  } else {
    await restoreLyricArtifactsFromExtractDir(sessionRoot, extractDir);
  }
  const pdfInfo = options?.mxlOnly
    ? { hasCleanScore: false, hasInput: false }
    : await restoreOmrWorkPdfsFromExtractDir(sessionRoot, extractDir, job);
  const reviewSrc = pick('review.mxl');
  const rawSrc = pick('audiveris_raw.mxl');
  const fixesSrc = pick('omr_hitl_fixes.json');
  const labelsSrc = pick('part_labels.json');
  const baselineSrc = pick('omr_hitl_baseline.mxl');
  const checkpointSrc = pick('omr_hitl_checkpoint.json');
  if (fixesSrc) await fs.copyFile(fixesSrc, sessionOmrHitlFixesPath(sessionRoot));
  else if (fsSync.existsSync(sessionOmrHitlFixesPath(sessionRoot))) {
    await fs.unlink(sessionOmrHitlFixesPath(sessionRoot)).catch(() => {});
  }
  if (labelsSrc) await fs.copyFile(labelsSrc, sessionPartLabelsPath(sessionRoot));
  if (rawSrc) await fs.copyFile(rawSrc, sessionAudiverisRawMxlPath(sessionRoot));
  if (checkpointSrc) {
    await fs.copyFile(checkpointSrc, sessionOmrHitlCheckpointPath(sessionRoot));
  } else if (fsSync.existsSync(sessionOmrHitlCheckpointPath(sessionRoot))) {
    await fs.unlink(sessionOmrHitlCheckpointPath(sessionRoot)).catch(() => {});
  }
  if (baselineSrc) {
    await fs.copyFile(baselineSrc, sessionHitlBaselineMxlPath(sessionRoot));
  } else if (fsSync.existsSync(sessionHitlBaselineMxlPath(sessionRoot))) {
    await fs.unlink(sessionHitlBaselineMxlPath(sessionRoot)).catch(() => {});
  }
  if (baselineSrc) {
    await fs.copyFile(baselineSrc, scorePath);
  } else if (reviewSrc) {
    await fs.copyFile(reviewSrc, scorePath);
  } else if (rawSrc) {
    await fs.copyFile(rawSrc, scorePath);
  } else {
    throw new Error('ZIP에 review.mxl 또는 audiveris_raw.mxl이 없습니다');
  }
  const fixesAfterImport = await readOmrHitlFixes(sessionRoot);
  let stats: Awaited<ReturnType<typeof syncOmrReviewMxl>>;
  stats = await syncOmrReviewMxl(sessionRoot, scorePath, pythonBin);
  await invalidateInspectScoreCache(sessionRoot);
  return {
    fixCount: fixesAfterImport.length,
    stats,
    pdfRestored: pdfInfo.hasCleanScore || pdfInfo.hasInput,
  };
}

async function bootstrapFromOmrWorkZip(
  job: JobRecord,
  zipPath: string,
  outBase: string,
  pythonBin: string,
  options?: OmrWorkImportOptions,
): Promise<string> {
  setJobProgress(job, {
    phase: 'hitl',
    current: 0,
    total: 3,
    detail: 'OMR 검토 ZIP 압축 해제 중…',
  });
  const extractDir = path.join(job.sessionRoot, `_omr_work_import_${Date.now()}`);
  await extractZipArchive(zipPath, extractDir, pythonBin);
  setJobProgress(job, {
    phase: 'hitl',
    current: 1,
    total: 3,
    detail: '저장된 MXL·보정 목록 복원 중…',
  });
  const base = resolveDownloadBaseName(job);
  const destMxl = path.join(outBase, `${base}.mxl`);
  await fs.mkdir(outBase, { recursive: true });
  const { fixCount, pdfRestored } = await importOmrWorkFromExtractDir(
    job.sessionRoot,
    extractDir,
    destMxl,
    pythonBin,
    job,
    options,
  );
  console.log(
    `[job] OMR work ZIP imported (${fixCount} fixes on record${options?.mxlOnly ? ', MXL-only' : ''}${pdfRestored ? ', PDF restored' : ''})`,
  );
  await fs.rm(extractDir, { recursive: true, force: true }).catch(() => {});
  setJobProgress(job, {
    phase: 'hitl',
    current: 2,
    total: 3,
    detail: `OMR 검토 ZIP 불러오기 완료 (보정 ${fixCount}건 기록)`,
  });
  return destMxl;
}

async function enterOmrStaffHitlPhase(
  job: JobRecord,
  jobId: string,
  mxlForInject: string[],
  pythonBin: string,
  scriptExtract: string,
  scriptMergeLyrics: string,
): Promise<void> {
  if (mxlForInject.length === 0 || job.enableOmrStaffReview === false) return;
  await ensureSessionLyricSourcePdf(job);
  let skipBaselinePrebuild =
    job.startStage === 'clean_score' || job.startStage === 'lyric_inject';
  if (!skipBaselinePrebuild) {
    const pymupdfPath = sessionOcrPymupdfReviewPath(job.sessionRoot);
    if (fsSync.existsSync(pymupdfPath)) {
      try {
        const raw = JSON.parse(await fs.readFile(pymupdfPath, 'utf8')) as unknown[];
        if (Array.isArray(raw) && reviewItemsHaveUserEdits(raw)) {
          skipBaselinePrebuild = true;
        }
      } catch {
        /* optional */
      }
    }
  }
  if (
    job.pipelineMode === 'font_separator' &&
    job.enablePymupdfReview !== false &&
    !skipBaselinePrebuild &&
    !fsSync.existsSync(sessionOcrPymupdfBaselinePath(job.sessionRoot))
  ) {
    const pdfPath = resolveLyricReviewPdfPath(job);
    if (pdfPath) {
      setJobProgress(job, {
        phase: 'separator',
        current: 0,
        total: 1,
        detail: '가사 검증용 PDF 초기 추출 준비 중…',
      });
      try {
        await bootstrapLyricReviewAfterOmrZipImport(
          job,
          pythonBin,
          scriptExtract,
          scriptMergeLyrics,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[job ${jobId}] lyric review baseline prebuild failed: ${msg}`);
      }
    }
  }
  for (const p of mxlForInject) {
    await restoreScoreFileFromAudiverisRaw(job.sessionRoot, p);
  }
  job.preInjectMxlPaths = [...mxlForInject];
  console.log(`[job ${jobId}] Pausing for part label setup (성부 S/A/T/B…)…`);
  setJobProgress(job, {
    phase: 'hitl',
    current: 0,
    total: 2,
    detail: '성부 라벨(S/A/T/B·PR/PL) 확인 대기…',
  });
  job.status = 'part_labels_needed';
  await new Promise<void>((resolve, reject) => {
    job.partLabelsDeferred = { resolve, reject };
  });
  delete job.partLabelsDeferred;
  job.status = 'processing';
  console.log(`[job ${jobId}] Part labels saved, continuing…`);
  try {
    const lintCache = sessionMxlLintPath(job.sessionRoot);
    if (fsSync.existsSync(lintCache)) {
      await fs.unlink(lintCache).catch(() => {});
    }
    await runMxlQualityLintForJob(job, mxlForInject[0], pythonBin);
    console.log(`[job ${jobId}] MXL lint saved (omr staff HITL)`);
  } catch (lintErr) {
    const msg = lintErr instanceof Error ? lintErr.message : String(lintErr);
    console.warn(`[job ${jobId}] mxl_quality_lint failed (continuing): ${msg}`);
  }
  console.log(`[job ${jobId}] Pausing for OMR staff·page review (HITL)…`);
  setJobProgress(job, {
    phase: 'hitl',
    current: 1,
    total: 2,
    detail: 'OMR 품질 검토(HITL) — PDF·MXL 대조·마디 편집 대기…',
  });
  job.status = 'omr_staff_review_needed';
  await new Promise<void>((resolve, reject) => {
    job.omrStaffReviewDeferred = { resolve, reject };
  });
  delete job.omrStaffReviewDeferred;
  job.status = 'processing';
  console.log(`[job ${jobId}] OMR staff review done, continuing pipeline…`);
}

async function runFontSeparatorResumePhase(opts: {
  job: JobRecord;
  jobId: string;
  startStage: StartStage;
  inputPdfPath: string;
  cleanScorePath: string;
  lyricManifestPath: string;
  extractedJsonPath: string;
  pymupdfReviewPath: string;
  ocrJsonPath: string;
  enablePymupdfReview: boolean;
  pythonBin: string;
  scriptExtract: string;
  scriptSeparator: string;
  scriptMergeLyrics: string;
  sessionRoot: string;
  fail: (payload: JobErrorPayload) => Promise<void>;
}): Promise<boolean> {
  const {
    job,
    jobId,
    startStage,
    inputPdfPath,
    cleanScorePath,
    lyricManifestPath,
    extractedJsonPath,
    pymupdfReviewPath,
    ocrJsonPath,
    enablePymupdfReview,
    pythonBin,
    scriptExtract,
    scriptSeparator,
    scriptMergeLyrics,
    sessionRoot,
    fail,
  } = opts;

  if (!job.resumeCleanScorePath || !fsSync.existsSync(job.resumeCleanScorePath)) {
    if (job.inputPdfPath && fsSync.existsSync(job.inputPdfPath)) {
      await fs.copyFile(job.inputPdfPath, cleanScorePath);
    } else {
      await fail({
        status: 400,
        error: 'clean_score_only.pdf가 필요합니다',
        detail:
          'font_separator 모드에서 가사 검증·OMR 단계부터 시작하려면 이전에 만든 clean_score_only.pdf를 함께 업로드하세요.',
      });
      return false;
    }
  } else {
    await fs.copyFile(job.resumeCleanScorePath, cleanScorePath);
  }
  if (job.resumeLyricManifestPath && fsSync.existsSync(job.resumeLyricManifestPath)) {
    await fs.copyFile(job.resumeLyricManifestPath, lyricManifestPath);
    await restoreFontStripConfigFromManifest(sessionRoot);
  }
  console.log(
    `[job ${jobId}] Resuming font_separator from ${startStage} (uploaded clean_score${job.resumeLyricManifestPath ? ', manifest' : ''})`,
  );

  const manifestReady = lyricManifestHasItems(lyricManifestPath);

  if (startStage === 'clean_score') {
    if (!manifestReady) {
      await fail({
        status: 400,
        error: '분리된 가사(lyric_manifest.json)가 필요합니다',
        detail:
          '2단계는 clean_score_only.pdf와 1단계에서 만든 lyric_manifest.json(또는 동등한 가사 JSON)을 함께 업로드해야 최종 MXL에 가사를 주입할 수 있습니다.',
      });
      return false;
    }
    await preparePymupdfReviewFromManifest(lyricManifestPath, pymupdfReviewPath);
    await restorePartLabelsFromManifest(sessionRoot, lyricManifestPath);
  }

  return true;
}

function isCleanScorePdfPath(job: JobRecord, absPath: string): boolean {
  const clean = sessionCleanScorePdfPath(job.sessionRoot);
  return fsSync.existsSync(clean) && path.resolve(absPath) === path.resolve(clean);
}

/** 가사 검증 UI 미리보기 — 원본(가사 포함) PDF 우선, clean_score_only는 최후 */
function resolveLyricReviewPdfPath(job: JobRecord): string | null {
  const candidates: string[] = [];
  const sessionInput = path.join(job.sessionRoot, 'input.pdf');
  const sessionOriginal = path.join(job.sessionRoot, 'original.pdf');
  if (fsSync.existsSync(sessionInput)) candidates.push(sessionInput);
  if (fsSync.existsSync(sessionOriginal)) candidates.push(sessionOriginal);
  if (job.inputPdfPath && fsSync.existsSync(job.inputPdfPath)) {
    candidates.push(job.inputPdfPath);
  }
  const lyricSource = candidates.find((p) => !isCleanScorePdfPath(job, p));
  if (lyricSource) return lyricSource;
  return candidates[0] ?? null;
}

/** 업로드 원본을 세션 input.pdf로 고정 — 가사 검증·ZIP 복원 경로 통일 */
async function ensureSessionLyricSourcePdf(job: JobRecord): Promise<void> {
  const dest = path.join(job.sessionRoot, 'input.pdf');
  if (fsSync.existsSync(dest)) return;
  const src = resolveLyricReviewPdfPath(job);
  if (!src || isCleanScorePdfPath(job, src)) return;
  await fs.copyFile(src, dest).catch(() => {});
}

/** omr-work.zip만으로 재개할 때 pdfplumber 추출이 없으면 병합 실패 방지 */
async function ensureExtractedMusicTextJson(
  sessionRoot: string,
  opts?: {
    inputPdfPath?: string | null;
    pythonBin?: string;
    scriptSeparator?: string;
  },
): Promise<string> {
  const extractedJsonPath = path.join(sessionRoot, 'extracted_music_text.json');
  if (fsSync.existsSync(extractedJsonPath)) {
    return extractedJsonPath;
  }
  const inputPdf = opts?.inputPdfPath?.trim();
  if (inputPdf && fsSync.existsSync(inputPdf) && opts.pythonBin && opts.scriptSeparator) {
    try {
      await exec(
        `"${opts.pythonBin}" "${opts.scriptSeparator}" extract "${inputPdf}" "${extractedJsonPath}"`,
      );
      if (fsSync.existsSync(extractedJsonPath)) {
        console.log('[session] extracted_music_text.json 생성 (pdfplumber 재추출)');
        return extractedJsonPath;
      }
    } catch (err) {
      console.warn('[session] pdfplumber 추출 실패 — 빈 extracted 사용', err);
    }
  }
  await fs.writeFile(extractedJsonPath, '[]\n', 'utf8');
  console.warn(
    '[session] extracted_music_text.json 없음 — 빈 배열로 대체 (omr-work·PyMuPDF 검토 병합)',
  );
  return extractedJsonPath;
}

/** OMR·HITL 후 가사 검증용 ocr_data_pymupdf.json — 없으면 manifest·원본 PDF에서 준비 */
async function ensurePymupdfReviewPayload(opts: {
  pymupdfReviewPath: string;
  lyricManifestPath: string;
  inputPdfPath: string | undefined;
  sessionRoot: string;
  pythonBin: string;
  scriptExtract: string;
}): Promise<boolean> {
  const { pymupdfReviewPath, lyricManifestPath, inputPdfPath, sessionRoot, pythonBin, scriptExtract } =
    opts;
  if (fsSync.existsSync(pymupdfReviewPath)) return true;

  const baselinePath = sessionOcrPymupdfBaselinePath(sessionRoot);
  if (fsSync.existsSync(baselinePath)) {
    await fs.copyFile(baselinePath, pymupdfReviewPath);
    return true;
  }

  if (fsSync.existsSync(lyricManifestPath)) {
    try {
      const manifest = JSON.parse(await fs.readFile(lyricManifestPath, 'utf8')) as {
        items?: unknown[];
      };
      const items = Array.isArray(manifest.items)
        ? manifest.items
        : Array.isArray(manifest)
          ? (manifest as unknown[])
          : null;
      if (items && items.length > 0) {
        await fs.writeFile(pymupdfReviewPath, JSON.stringify(items, null, 2), 'utf8');
        return true;
      }
    } catch {
      /* fall through */
    }
  }

  const sessionInput = path.join(sessionRoot, 'input.pdf');
  const pdfForExtract =
    fsSync.existsSync(sessionInput)
      ? sessionInput
      : inputPdfPath && fsSync.existsSync(inputPdfPath)
        ? inputPdfPath
        : null;
  if (!pdfForExtract) return false;

  try {
    await exec(`"${pythonBin}" "${scriptExtract}" "${pdfForExtract}" "${pymupdfReviewPath}"`);
  } catch (err) {
    console.warn('[job] ensurePymupdfReviewPayload extract_text failed:', err);
  }
  return fsSync.existsSync(pymupdfReviewPath);
}

/** 검토 UI용 — 성부·절·건너뛰기 등 사람이 넣은 메타만 제거 */
function stripLyricReviewMeta(item: unknown): unknown {
  if (!item || typeof item !== 'object') return item;
  const o = { ...(item as Record<string, unknown>) };
  delete o.lyricPartIndex;
  delete o.lyricVerseIndex;
  delete o.lyricVoice;
  delete o.lyricSkipNotes;
  return o;
}

function stripLyricReviewMetaList(items: unknown[]): unknown[] {
  return items.map(stripLyricReviewMeta);
}

/** 검토 UI PDF 초기 추출 — 마디·페이지 번호만 유지, 나머지 기본 역할 가사 */
function applyBaselineReviewShape(items: unknown[]): unknown[] {
  return items.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const o = stripLyricReviewMeta(item) as Record<string, unknown>;
    if (typeof o.rawText !== 'string' && typeof o.text === 'string') {
      o.rawText = o.text;
    }
    const t = o.type;
    if (t === 'measure_number' || t === 'page_number') {
      return o;
    }
    o.type = 'lyrics';
    return o;
  });
}

/** 원본 PDF 1차 추출 — PyMuPDF 전체 + pdfplumber 가사 보강 */
async function buildInitialLyricReviewItems(opts: {
  sessionRoot: string;
  pdfPath: string;
  pythonBin: string;
  scriptExtract: string;
  scriptMergeLyrics: string;
}): Promise<unknown[]> {
  const { sessionRoot, pdfPath, pythonBin, scriptExtract } = opts;
  const extractedJsonPath = path.join(sessionRoot, 'extracted_music_text.json');
  const tempPymupdf = path.join(sessionRoot, '_lyric_baseline_pymupdf.json');

  await fs.unlink(tempPymupdf).catch(() => {});
  // NOTE: 사용자가 "원본 라인 그대로" 검증을 원해 baseline은 PyMuPDF 1차 추출만 사용합니다.
  // (pdfplumber 병합/보강은 lyric_manifest 생성 단계에서만 사용)

  await exec(`"${pythonBin}" "${scriptExtract}" "${pdfPath}" "${tempPymupdf}"`, {
    maxBuffer: 16 * 1024 * 1024,
  });

  const raw = JSON.parse(await fs.readFile(tempPymupdf, 'utf8')) as unknown;
  await fs.unlink(tempPymupdf).catch(() => {});
  if (!Array.isArray(raw)) {
    throw new Error('extract_text.py 출력이 배열이 아닙니다');
  }
  return applyBaselineReviewShape(stripLyricReviewMetaList(raw));
}

async function persistLyricReviewBaseline(
  sessionRoot: string,
  items: unknown[],
): Promise<void> {
  await fs.writeFile(
    sessionOcrPymupdfBaselinePath(sessionRoot),
    JSON.stringify(items, null, 2),
    'utf8',
  );
}

async function activateLyricReviewItems(sessionRoot: string, items: unknown[]): Promise<void> {
  await fs.writeFile(
    sessionOcrPymupdfReviewPath(sessionRoot),
    JSON.stringify(items, null, 2),
    'utf8',
  );
}

async function ensureLyricReviewBaseline(opts: {
  sessionRoot: string;
  pdfPath: string;
  pythonBin: string;
  scriptExtract: string;
  scriptMergeLyrics: string;
  forceRebuild?: boolean;
}): Promise<unknown[]> {
  const baselinePath = sessionOcrPymupdfBaselinePath(opts.sessionRoot);
  if (!opts.forceRebuild && fsSync.existsSync(baselinePath)) {
    const cached = JSON.parse(await fs.readFile(baselinePath, 'utf8')) as unknown[];
    return applyBaselineReviewShape(cached);
  }
  const items = await buildInitialLyricReviewItems(opts);
  await persistLyricReviewBaseline(opts.sessionRoot, items);
  return items;
}

/** omr-work.zip 불러온 뒤 — 가사 검증은 PDF 1차 추출 기준으로 시작 */
async function bootstrapLyricReviewAfterOmrZipImport(
  job: JobRecord,
  pythonBin: string,
  scriptExtract: string,
  scriptMergeLyrics: string,
): Promise<void> {
  const pdfPath = resolveLyricReviewPdfPath(job);
  if (!pdfPath) return;
  const savedPath = sessionOcrPymupdfSavedPath(job.sessionRoot);
  job.hasSavedLyricReview = fsSync.existsSync(savedPath);
  const items = await ensureLyricReviewBaseline({
    sessionRoot: job.sessionRoot,
    pdfPath,
    pythonBin,
    scriptExtract,
    scriptMergeLyrics,
    forceRebuild: true,
  });
  await activateLyricReviewItems(job.sessionRoot, items);
}

/** OMR·HITL 후 가사 검증 UI — 편집된 manifest·pymupdf 우선, 없으면 PDF 초기 추출 */
async function preparePostOmrLyricReviewItems(
  job: JobRecord,
  pythonBin: string,
  scriptExtract: string,
  scriptMergeLyrics: string,
): Promise<unknown[] | null> {
  await ensureSessionLyricSourcePdf(job);
  const pdfPath = resolveLyricReviewPdfPath(job);
  const pymupdfPath = sessionOcrPymupdfReviewPath(job.sessionRoot);
  const manifestPath = sessionLyricManifestPath(job.sessionRoot);
  const savedPath = sessionOcrPymupdfSavedPath(job.sessionRoot);
  const resumeFromPriorStage =
    job.startStage === 'clean_score' || job.startStage === 'lyric_inject';

  const activate = async (raw: unknown[], preservesEdits: boolean): Promise<unknown[]> => {
    const shaped = preservesEdits ? applyEditedReviewShape(raw) : applyBaselineReviewShape(raw);
    const items = applyReviewUiDefaultRoles(shaped);
    job.reviewPreservesEdits = preservesEdits;
    await activateLyricReviewItems(job.sessionRoot, items);
    return items;
  };

  if (fsSync.existsSync(pymupdfPath)) {
    try {
      const raw = JSON.parse(await fs.readFile(pymupdfPath, 'utf8')) as unknown[];
      if (Array.isArray(raw) && raw.length > 0 && (reviewItemsHaveUserEdits(raw) || resumeFromPriorStage)) {
        return activate(raw, reviewItemsHaveUserEdits(raw) || resumeFromPriorStage);
      }
    } catch {
      /* fall through */
    }
  }

  const fromManifest = await loadLyricReviewItemsFromManifest(manifestPath);
  if (fromManifest?.length && (reviewItemsHaveUserEdits(fromManifest) || resumeFromPriorStage)) {
    return activate(fromManifest, true);
  }

  if (fsSync.existsSync(savedPath)) {
    try {
      const raw = JSON.parse(await fs.readFile(savedPath, 'utf8')) as unknown[];
      if (Array.isArray(raw) && raw.length > 0 && reviewItemsHaveUserEdits(raw)) {
        return activate(raw, true);
      }
    } catch {
      /* fall through */
    }
  }

  if (!pdfPath) return null;

  const baselinePath = sessionOcrPymupdfBaselinePath(job.sessionRoot);
  if (fsSync.existsSync(baselinePath)) {
    const raw = JSON.parse(await fs.readFile(baselinePath, 'utf8')) as unknown[];
    return activate(raw, false);
  }

  const items = await ensureLyricReviewBaseline({
    sessionRoot: job.sessionRoot,
    pdfPath,
    pythonBin,
    scriptExtract,
    scriptMergeLyrics,
    forceRebuild: true,
  });
  return activate(items, false);
}

async function loadSavedLyricReviewItems(sessionRoot: string): Promise<unknown[]> {
  const savedPath = sessionOcrPymupdfSavedPath(sessionRoot);
  if (!fsSync.existsSync(savedPath)) {
    throw new Error('ZIP에 저장된 가사 검증 데이터가 없습니다');
  }
  const raw = JSON.parse(await fs.readFile(savedPath, 'utf8')) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error('저장된 가사 검증 JSON이 배열이 아닙니다');
  }
  return raw;
}

/** Audiveris·점검 UI에 넘길 PDF — clean_score > masked > 원본 순 */
function resolveAudiverisInputPdfPath(job: JobRecord): {
  path: string;
  kind: 'clean_score' | 'masked' | 'original';
} | null {
  const orig = job.inputPdfPath;
  if (!orig || !fsSync.existsSync(orig)) return null;
  const clean = sessionCleanScorePdfPath(job.sessionRoot);
  if (fsSync.existsSync(clean)) return { path: clean, kind: 'clean_score' };
  const masked = sessionMaskedPdfPath(job.sessionRoot);
  if (fsSync.existsSync(masked)) return { path: masked, kind: 'masked' };
  return { path: orig, kind: 'original' };
}

function setAttachmentFilenameHeader(res: express.Response, filename: string): void {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_');
  const encoded = encodeURIComponent(filename);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
  );
}

function sendDiagnosticSessionPdf(
  res: express.Response,
  absPath: string,
  downloadBaseName: string,
  attachment: boolean,
): void {
  const safeAscii = `${downloadBaseName}.pdf`.replace(/[^\x20-\x7E]/g, '_');
  const encoded = encodeURIComponent(`${downloadBaseName}.pdf`);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.setHeader(
    'Content-Disposition',
    `${attachment ? 'attachment' : 'inline'}; filename="${safeAscii}"; filename*=UTF-8''${encoded}`,
  );
  res.sendFile(path.resolve(absPath), (err) => {
    if (err && !res.headersSent) res.status(500).json({ error: String(err) });
  });
}

function parseAudiverisProgressLine(line: string, pageFallback: number): { current: number; total: number } | null {
  const slash = line.match(/(\d+)\s*\/\s*(\d+)/);
  if (slash) {
    const a = parseInt(slash[1], 10);
    const b = parseInt(slash[2], 10);
    if (b > 0 && a >= 0 && a <= b) return { current: a, total: b };
  }
  const sheet = line.match(/(?:sheet|page|페이지)\s*[#:：]?\s*(\d+)/i);
  if (sheet && pageFallback > 0) {
    const n = parseInt(sheet[1], 10);
    if (n > 0) return { current: Math.min(n, pageFallback), total: pageFallback };
  }
  return null;
}

function pdftomusicFailureDetail(): string {
  return (
    'PDFtoMusic Pro(p2mp)가 MXL을 생성하지 못했습니다. ' +
    'clean_score_only.pdf가 **벡터 PDF**(악보 편집기에서 내보낸 PDF)인지, ' +
    'P2MP_BIN이 올바른지 확인하세요. 스캔/비트맵 PDF는 PDFtoMusic Pro로 처리할 수 없습니다. ' +
    '아래 로그를 검토하세요.'
  );
}

function aiOmrFailureDetail(): string {
  const backend = (process.env.AI_OMR_BACKEND || 'homr').trim().toLowerCase();
  if (backend === 'homr') {
    return (
      'homr OMR이 MXL을 생성하지 못했습니다. 서버 venv에서 ' +
      '`pip install -r requirements-ai.txt` 후 `homr --init`(또는 `python scripts/run_homr.py --init`)으로 가중치를 받았는지 확인하세요. ' +
      '아래 로그를 검토하세요.'
    );
  }
  if (backend === 'tromr') {
    return (
      'TrOMR(HuggingFace) OMR 실패. `AI_OMR_MODEL`이 유효한 공개 체크포인트인지 확인하거나 ' +
      '`AI_OMR_BACKEND=homr`(기본)로 전환하세요. 아래 로그를 검토하세요.'
    );
  }
  return 'AI OMR이 MXL을 생성하지 못했습니다. 아래 로그를 검토하세요.';
}

function tail(s: string, max = 8000): string {
  if (s.length <= max) return s;
  return s.slice(-max);
}

async function mergeOcrMetaTranspose(sessionRoot: string, semitones: number): Promise<void> {
  const metaPath = path.join(sessionRoot, 'ocr_meta.json');
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(await fs.readFile(metaPath, 'utf8')) as Record<string, unknown>;
  } catch {
    /* no file or invalid */
  }
  meta.transposeSemitones = Math.max(-24, Math.min(24, Math.round(semitones)));
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
}

type FontStripRangeDto = { minPt: number; maxPt: number; label?: string };

function fontStripConfigPath(sessionRoot: string): string {
  return path.join(sessionRoot, 'font_strip_config.json');
}

function fontStripStatsPath(sessionRoot: string): string {
  return path.join(sessionRoot, 'font_strip_stats.json');
}

function rangesToCliSpec(ranges: FontStripRangeDto[]): string {
  return ranges.map((r) => `${r.minPt}-${r.maxPt}`).join(',');
}

function parseFontStripRangesBody(body: unknown): FontStripRangeDto[] | null {
  if (!body || typeof body !== 'object') return null;
  const raw = (body as { ranges?: unknown }).ranges;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: FontStripRangeDto[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as { minPt?: unknown; maxPt?: unknown; label?: unknown };
    const minPt = Number(o.minPt);
    const maxPt = Number(o.maxPt);
    if (!Number.isFinite(minPt) || !Number.isFinite(maxPt)) continue;
    out.push({
      minPt: Math.min(minPt, maxPt),
      maxPt: Math.max(minPt, maxPt),
      label: typeof o.label === 'string' ? o.label : undefined,
    });
  }
  return out.length ? out : null;
}

type ScoreTitleDto = {
  text: string;
  page?: number;
  bbox?: [number, number, number, number];
  fontSize?: number;
  detected?: boolean;
  mask?: boolean;
};

function bboxIou(a: number[], b: number[]): number {
  const ix0 = Math.max(a[0], b[0]);
  const iy0 = Math.max(a[1], b[1]);
  const ix1 = Math.min(a[2], b[2]);
  const iy1 = Math.min(a[3], b[3]);
  if (ix1 <= ix0 || iy1 <= iy0) return 0;
  const inter = (ix1 - ix0) * (iy1 - iy0);
  const areaA = Math.max(0, (a[2] - a[0]) * (a[3] - a[1]));
  const areaB = Math.max(0, (b[2] - b[0]) * (b[3] - b[1]));
  const denom = areaA + areaB - inter;
  return denom <= 0 ? 0 : inter / denom;
}

function applyScoreTitleToManifest(manifest: Record<string, unknown>): void {
  const fontStrip = manifest.fontStrip;
  if (!fontStrip || typeof fontStrip !== 'object') return;
  const scoreTitle = (fontStrip as { scoreTitle?: ScoreTitleDto }).scoreTitle;
  if (!scoreTitle?.text?.trim()) return;
  const text = scoreTitle.text.trim();
  const page = Number.isFinite(scoreTitle.page) ? Math.max(1, Math.round(scoreTitle.page!)) : 1;
  const bbox = scoreTitle.bbox;
  const hasBbox = Array.isArray(bbox) && bbox.length >= 4;

  const matchItem = (item: Record<string, unknown>): boolean => {
    if (Number(item.page) !== page) return false;
    const ib = item.bbox;
    if (hasBbox && Array.isArray(ib) && ib.length >= 4) {
      return bboxIou(bbox as number[], ib as number[]) >= 0.2;
    }
    if (item.type === 'title') return true;
    const itemText = String(item.text ?? '').replace(/\s/g, '');
    const cand = text.replace(/\s/g, '');
    return Boolean(itemText && cand && (itemText.includes(cand) || cand.includes(itemText)));
  };

  const patchItem = (item: Record<string, unknown>): void => {
    item.type = 'title';
    item.text = text;
    if (hasBbox) item.bbox = [...bbox!];
  };

  for (const key of ['items', 'pymupdfReviewItems'] as const) {
    const coll = manifest[key];
    if (!Array.isArray(coll)) continue;
    let matched = false;
    for (const raw of coll) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const t = String(item.type ?? '');
      if (t.startsWith('_')) continue;
      if (matchItem(item)) {
        patchItem(item);
        matched = true;
        break;
      }
    }
    if (!matched && key === 'items' && hasBbox) {
      coll.unshift({
        id: 'score_title',
        page,
        text,
        type: 'title',
        bbox: [...bbox!],
        confidence: 1,
        provenance: 'scoreTitle',
      });
    }
  }
}

async function detectScoreTitleCandidate(
  pythonBin: string,
  scriptSeparator: string,
  extractedJsonPath: string,
): Promise<ScoreTitleDto | null> {
  if (!fsSync.existsSync(extractedJsonPath)) return null;
  try {
    const { stdout } = await exec(
      `"${pythonBin}" "${scriptSeparator}" detect-title "${extractedJsonPath}"`,
      { maxBuffer: 4 * 1024 * 1024 },
    );
    const data = JSON.parse(String(stdout).trim()) as ScoreTitleDto;
    if (!data?.text?.trim()) return null;
    return data;
  } catch {
    return null;
  }
}

async function invalidateCleanScorePreviewCache(sessionRoot: string): Promise<void> {
  const cacheDir = path.join(sessionRoot, '.diag-cache');
  try {
    const files = await fs.readdir(cacheDir);
    await Promise.all(
      files
        .filter((f) => f.includes('clean_score-preview'))
        .map((f) => fs.unlink(path.join(cacheDir, f)).catch(() => {})),
    );
  } catch {
    /* no cache */
  }
}

async function applyScoreTitleMaskOnPdf(
  pythonBin: string,
  scriptSeparator: string,
  sessionRoot: string,
  cleanPdfPath: string,
  scoreTitle: ScoreTitleDto,
): Promise<void> {
  if (scoreTitle.mask === false) return;
  if (!Array.isArray(scoreTitle.bbox) || scoreTitle.bbox.length < 4) return;
  const tmpJson = path.join(sessionRoot, '.score_title_mask.json');
  await fs.writeFile(tmpJson, JSON.stringify(scoreTitle), 'utf8');
  try {
    await exec(
      `"${pythonBin}" "${scriptSeparator}" mask-title "${cleanPdfPath}" "${tmpJson}"`,
      { maxBuffer: 16 * 1024 * 1024 },
    );
    await invalidateCleanScorePreviewCache(sessionRoot);
  } finally {
    await fs.unlink(tmpJson).catch(() => {});
  }
}

async function readFontStripConfig(sessionRoot: string): Promise<Record<string, unknown>> {
  const cfgPath = fontStripConfigPath(sessionRoot);
  if (!fsSync.existsSync(cfgPath)) return { ranges: [] };
  try {
    return JSON.parse(await fs.readFile(cfgPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return { ranges: [] };
  }
}

async function writeFontStripConfig(sessionRoot: string, cfg: Record<string, unknown>): Promise<void> {
  await fs.writeFile(fontStripConfigPath(sessionRoot), JSON.stringify(cfg, null, 2), 'utf8');
}

/** scoreTitle을 font_strip_config ↔ lyric_manifest 양쪽에 맞추고 inject용 title 항목을 갱신 */
async function syncScoreTitlePersistence(sessionRoot: string, manifestPath: string): Promise<void> {
  if (!fsSync.existsSync(manifestPath)) return;
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    const cfg = await readFontStripConfig(sessionRoot);
    const fromCfg = cfg.scoreTitle as ScoreTitleDto | undefined;
    const fromManifestTop = manifest.scoreTitle as ScoreTitleDto | undefined;
    const fromFontStrip = (manifest.fontStrip as { scoreTitle?: ScoreTitleDto } | undefined)?.scoreTitle;
    const winner =
      (fromCfg?.text?.trim() ? fromCfg : undefined) ??
      (fromManifestTop?.text?.trim() ? fromManifestTop : undefined) ??
      (fromFontStrip?.text?.trim() ? fromFontStrip : undefined);
    if (winner?.text?.trim()) {
      if (!manifest.fontStrip || typeof manifest.fontStrip !== 'object') {
        manifest.fontStrip = {};
      }
      (manifest.fontStrip as Record<string, unknown>).scoreTitle = winner;
      manifest.scoreTitle = winner;
      cfg.scoreTitle = winner;
      if (!Array.isArray(cfg.ranges)) {
        const fsRanges = (manifest.fontStrip as { ranges?: FontStripRangeDto[] }).ranges;
        if (Array.isArray(fsRanges)) cfg.ranges = fsRanges;
      }
      await writeFontStripConfig(sessionRoot, cfg);
    }
    applyScoreTitleToManifest(manifest);
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  } catch (e) {
    console.warn('[syncScoreTitlePersistence]', e);
  }
}

async function restoreFontStripConfigFromManifest(sessionRoot: string): Promise<void> {
  const manifestPath = sessionLyricManifestPath(sessionRoot);
  const cfgPath = fontStripConfigPath(sessionRoot);
  if (fsSync.existsSync(cfgPath) || !fsSync.existsSync(manifestPath)) return;
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    const fontStrip = manifest.fontStrip;
    if (fontStrip && typeof fontStrip === 'object') {
      await fs.writeFile(cfgPath, JSON.stringify(fontStrip, null, 2), 'utf8');
    }
  } catch {
    /* optional */
  }
}

async function ensureAutoScoreTitleInConfig(
  sessionRoot: string,
  extractedJsonPath: string,
  pythonBin: string,
  scriptSeparator: string,
): Promise<ScoreTitleDto | null> {
  const cfg = await readFontStripConfig(sessionRoot);
  const existing = cfg.scoreTitle as ScoreTitleDto | undefined;
  if (existing?.text?.trim()) return existing;
  const cand = await detectScoreTitleCandidate(pythonBin, scriptSeparator, extractedJsonPath);
  if (!cand) return null;
  cfg.scoreTitle = { ...cand, mask: true };
  await writeFontStripConfig(sessionRoot, cfg);
  return cfg.scoreTitle as ScoreTitleDto;
}

async function analyzeFontSizesFromExtracted(
  pythonBin: string,
  scriptSeparator: string,
  extractedJsonPath: string,
): Promise<Record<string, unknown>> {
  const { stdout } = await exec(
    `"${pythonBin}" "${scriptSeparator}" analyze "${extractedJsonPath}"`,
    { maxBuffer: 16 * 1024 * 1024 },
  );
  return JSON.parse(String(stdout).trim()) as Record<string, unknown>;
}

async function executeJob(jobId: string, audiverisBin: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  if (!job.inputPdfPath && job.resumeCleanScorePath && fsSync.existsSync(job.resumeCleanScorePath)) {
    job.inputPdfPath = job.resumeCleanScorePath;
    if (!job.sourcePdfDisplayName) {
      rememberSourcePdfDisplayName(job, path.basename(job.resumeCleanScorePath));
    }
    if (!job.originalName || job.originalName === 'input.pdf') {
      job.originalName = path.basename(job.resumeCleanScorePath) || 'clean_score_only.pdf';
    }
  }

  const pipelineMode: PipelineMode = job.pipelineMode ?? 'font_separator';
  const startStageEarly: StartStage = job.startStage ?? 'full';
  const enablePymupdfReview =
    pipelineMode === 'font_separator'
      ? startStageEarly === 'lyric_inject' || job.enablePymupdfReview !== false
      : true;
  const { sessionRoot, originalName, isDebug } = job;
  const inputPdfPath = job.inputPdfPath;
  await ensureSessionLyricSourcePdf(job);
  const outBase = path.join(sessionRoot, 'audiveris-out');
  const wipeSession = () => fs.rm(sessionRoot, { recursive: true, force: true }).catch(() => {});

  const fail = async (payload: JobErrorPayload) => {
    await wipeSession();
    job.status = 'failed';
    job.error = payload;
    job.finishedAt = Date.now();
    delete job.progress;
  };

  if (!inputPdfPath && (job.startStage ?? 'full') !== 'omr_hitl' && (job.startStage ?? 'full') !== 'lyric_inject') {
    await fail({
      status: 400,
      error: '입력 PDF가 없습니다',
      detail: '원본 PDF 또는 clean_score_only.pdf를 업로드하세요.',
    });
    return;
  }

  job.status = 'processing';

  const pythonBin = resolvePythonBin();
  const omrEngineAtStart = resolveOmrEngine();
  if (omrEngineAtStart === 'ai') {
    const aiDeps = await probeAiOmrDeps(pythonBin);
    if (!aiDeps.ok) {
      await fail({
        status: 503,
        error: 'AI OMR Python 의존성이 없습니다',
        detail: aiDeps.hint || `누락: ${aiDeps.missing.join(', ')}`,
      });
      return;
    }
  } else if (omrEngineAtStart === 'pdftomusic') {
    const p2mDeps = await probePdfToMusicDeps();
    if (!p2mDeps.ok) {
      await fail({
        status: 503,
        error: 'PDFtoMusic Pro(p2mp)가 준비되지 않았습니다',
        detail: p2mDeps.hint || p2mpInstallHint(),
      });
      return;
    }
  }
  const scriptExtract = path.join(__dirname, '..', 'scripts', 'extract_text.py');
  const scriptMask = path.join(__dirname, '..', 'scripts', 'mask_pdf.py');
  const scriptSeparator = path.join(__dirname, '..', 'scripts', 'pdf_separator.py');
  const scriptMergeLyrics = path.join(__dirname, '..', 'scripts', 'merge_lyric_sources.py');
  const ocrJsonPath = path.join(sessionRoot, 'ocr_data.json');
  const pymupdfReviewPath = path.join(sessionRoot, 'ocr_data_pymupdf.json');
  const extractedJsonPath = path.join(sessionRoot, 'extracted_music_text.json');
  const lyricManifestPath = path.join(sessionRoot, 'lyric_manifest.json');
  const cleanScorePath = sessionCleanScorePdfPath(sessionRoot);
  const maskedPdfPath = sessionMaskedPdfPath(sessionRoot);

  try {
    await fs.mkdir(outBase, { recursive: true });

    const pageHint = job.pdfPageCount && job.pdfPageCount > 0 ? job.pdfPageCount : 1;
    const startStage: StartStage = job.startStage ?? 'full';
    let outputs: string[] = [];
    let mxlForInject: string[] = [];
    let pauseForAudiverisReview = Boolean(job.pauseAfterAudiveris);
    let skipAudiverisEngine = false;

    if (startStage === 'omr_hitl') {
      if (!job.resumeOmrWorkZipPath || !fsSync.existsSync(job.resumeOmrWorkZipPath)) {
        await fail({
          status: 400,
          error: 'OMR 검토 작업 ZIP이 필요합니다',
          detail:
            'OMR 품질 검토에서 「작업 저장(ZIP)」으로 받은 omr-work.zip을 함께 업로드하세요. Audiveris 재인식 없이 저장된 MXL·보정으로 검토를 이어갑니다.',
        });
        return;
      }
      setJobProgress(job, {
        phase: 'hitl',
        current: 0,
        total: pageHint,
        detail: '저장된 OMR 검토 ZIP 불러오는 중 (Audiveris 생략)…',
      });
      const mxlPath = await bootstrapFromOmrWorkZip(
        job,
        job.resumeOmrWorkZipPath,
        outBase,
        pythonBin,
      );
      outputs = [mxlPath];
      mxlForInject = [mxlPath];
      skipAudiverisEngine = true;
      if (job.resumeLyricManifestPath && fsSync.existsSync(job.resumeLyricManifestPath)) {
        await fs.copyFile(job.resumeLyricManifestPath, lyricManifestPath);
      }
      if (!lyricManifestHasItems(lyricManifestPath)) {
        await fail({
          status: 400,
          error: 'ZIP에 분리된 가사가 없습니다',
          detail:
            '3단계 omr-work.zip에는 lyric_manifest.json(또는 ocr_data_pymupdf.json)이 포함되어야 합니다. 1단계에서 저장한 ZIP을 쓰거나 가사 JSON을 함께 업로드하세요.',
        });
        return;
      }
      if (
        !fsSync.existsSync(cleanScorePath) &&
        job.resumeCleanScorePath &&
        fsSync.existsSync(job.resumeCleanScorePath)
      ) {
        await fs.copyFile(job.resumeCleanScorePath, cleanScorePath);
        if (!job.inputPdfPath) job.inputPdfPath = cleanScorePath;
      } else if (!job.inputPdfPath && fsSync.existsSync(cleanScorePath)) {
        job.inputPdfPath = cleanScorePath;
      }
      await bootstrapLyricReviewAfterOmrZipImport(
        job,
        pythonBin,
        scriptExtract,
        scriptMergeLyrics,
      );
      await ensureExtractedMusicTextJson(sessionRoot, {
        inputPdfPath: resolveLyricReviewPdfPath(job),
        pythonBin,
        scriptSeparator,
      });
    }

    if (startStage === 'lyric_inject') {
      if (!job.resumeOmrWorkZipPath || !fsSync.existsSync(job.resumeOmrWorkZipPath)) {
        await fail({
          status: 400,
          error: 'OMR 검토 작업 ZIP이 필요합니다',
          detail: '4단계는 교정 완료 MXL이 들어 있는 omr-work.zip을 업로드하세요.',
        });
        return;
      }
      if (!job.resumeLyricManifestPath || !fsSync.existsSync(job.resumeLyricManifestPath)) {
        await fail({
          status: 400,
          error: '가사 JSON 파일이 필요합니다',
          detail: '4단계는 편집 중인 가사 JSON(lyric_manifest.json 등)을 함께 업로드하세요.',
        });
        return;
      }

      setJobProgress(job, {
        phase: 'hitl',
        current: 0,
        total: pageHint,
        detail: '교정 완료 MXL·가사 데이터 불러오는 중…',
      });
      const mxlPath = await bootstrapFromOmrWorkZip(
        job,
        job.resumeOmrWorkZipPath,
        outBase,
        pythonBin,
      );
      outputs = [mxlPath];
      mxlForInject = [mxlPath];
      skipAudiverisEngine = true;
      pauseForAudiverisReview = false;

      await fs.copyFile(job.resumeLyricManifestPath, lyricManifestPath);
      await preparePymupdfReviewFromManifest(lyricManifestPath, pymupdfReviewPath);
      await restorePartLabelsFromManifest(job.sessionRoot, lyricManifestPath);
    }

    if (!skipAudiverisEngine) {
    if (pipelineMode === 'audiveris_only') {
      setJobProgress(job, {
        phase: 'upload',
        current: 1,
        total: 1,
        detail: 'Audiveris 준비 중 (선행 처리 없음)…',
      });
    } else if (pipelineMode === 'font_separator') {
      const depCheck = await probeFontSeparatorDeps(pythonBin);
      if (!depCheck.ok) {
        await fail(formatFontSeparatorDepsError(depCheck));
        return;
      }

      const resumeWithCleanScore =
        startStage === 'clean_score' &&
        job.resumeCleanScorePath &&
        fsSync.existsSync(job.resumeCleanScorePath);

      if (resumeWithCleanScore) {
        const ok = await runFontSeparatorResumePhase({
          job,
          jobId,
          startStage,
          inputPdfPath,
          cleanScorePath,
          lyricManifestPath,
          extractedJsonPath,
          pymupdfReviewPath,
          ocrJsonPath,
          enablePymupdfReview,
          pythonBin,
          scriptExtract,
          scriptSeparator,
          scriptMergeLyrics,
          sessionRoot,
          fail,
        });
        if (!ok) return;
      } else if (startStage === 'clean_score') {
        await fail({
          status: 400,
          error: '2단계에 clean_score PDF와 가사 JSON이 필요합니다',
          detail:
            'clean_score_only.pdf와 lyric_manifest.json(분리된 가사)을 함께 업로드하세요.',
        });
        return;
      } else {

      setJobProgress(job, {
        phase: 'separator',
        current: 0,
        total: 2,
        detail: 'pdfplumber로 문자 레이아웃 추출 중…',
      });
      console.log(`[job ${jobId}] pdf_separator extract using ${pythonBin}`);
      try {
        await exec(
          `"${pythonBin}" "${scriptSeparator}" extract "${inputPdfPath}" "${extractedJsonPath}"`,
        );
      } catch (sepExecErr) {
        const msg = sepExecErr instanceof Error ? sepExecErr.message : String(sepExecErr);
        const missing = FONT_SEPARATOR_PY_MODULES.filter((m) => isMissingPythonModuleError(msg, m));
        if (missing.length > 0) {
          await fail(formatFontSeparatorDepsError({ pythonBin, missing: [...missing] }));
          return;
        }
        throw sepExecErr;
      }
      if (!fsSync.existsSync(extractedJsonPath)) {
        await fail({
          status: 500,
          error: 'extracted_music_text.json 생성 실패',
          detail: 'pdfplumber 추출 결과가 없습니다.',
        });
        return;
      }

      const fontStats = await analyzeFontSizesFromExtracted(
        pythonBin,
        scriptSeparator,
        extractedJsonPath,
      );
      await fs.writeFile(fontStripStatsPath(sessionRoot), JSON.stringify(fontStats, null, 2), 'utf8');
      job.fontStripStats = fontStats;

      const replaceTripletPua = process.env.CLEAN_SCORE_REPLACE_TRIPLET_PUA === '1';
      const stripPuaFlag = replaceTripletPua ? ' --replace-triplet-pua' : '';

      for (;;) {
        console.log(`[job ${jobId}] Pausing for font size strip selection…`);
        job.status = 'font_strip_needed';
        await new Promise<void>((resolve, reject) => {
          job.fontStripDeferred = { resolve, reject };
        });
        delete job.fontStripDeferred;
        job.status = 'processing';
        console.log(`[job ${jobId}] Font strip selection completed`);

        const stripConfigRaw = await fs.readFile(fontStripConfigPath(sessionRoot), 'utf8');
        const stripConfig = JSON.parse(stripConfigRaw) as { ranges?: FontStripRangeDto[] };
        const stripRanges = stripConfig.ranges ?? [{ minPt: 7, maxPt: 17 }];
        const rangeSpec = rangesToCliSpec(stripRanges);

        setJobProgress(job, {
          phase: 'separator',
          current: 1,
          total: 2,
          detail: `pikepdf 텍스트 제거 (${rangeSpec})…`,
        });
        console.log(`[job ${jobId}] pdf_separator strip ranges=${rangeSpec}`);
        try {
          await exec(
            `"${pythonBin}" "${scriptSeparator}" strip "${inputPdfPath}" "${cleanScorePath}" --ranges "${rangeSpec}"${stripPuaFlag}`,
          );
        } catch (stripErr) {
          const msg = stripErr instanceof Error ? stripErr.message : String(stripErr);
          await fail({
            status: 500,
            error: 'clean_score_only.pdf 생성 실패',
            detail: msg,
          });
          return;
        }
        if (!fsSync.existsSync(cleanScorePath)) {
          await fail({
            status: 500,
            error: 'clean_score_only.pdf 생성 실패',
            detail: 'pdf_separator.py가 악보 PDF를 만들지 못했습니다.',
          });
          return;
        }

        const scoreTitleForMask = await ensureAutoScoreTitleInConfig(
          sessionRoot,
          extractedJsonPath,
          pythonBin,
          scriptSeparator,
        );
        if (scoreTitleForMask) {
          try {
            await applyScoreTitleMaskOnPdf(
              pythonBin,
              scriptSeparator,
              sessionRoot,
              cleanScorePath,
              scoreTitleForMask,
            );
            console.log(
              `[job ${jobId}] scoreTitle bbox mask applied (${scoreTitleForMask.text?.slice(0, 24) ?? ''})`,
            );
          } catch (maskErr) {
            console.warn(`[job ${jobId}] scoreTitle mask failed:`, maskErr);
          }
        }

        console.log(`[job ${jobId}] Pausing for clean_score PDF preview…`);
        job.cleanScorePreviewAction = undefined;
        job.status = 'clean_score_preview_needed';
        await new Promise<void>((resolve, reject) => {
          job.cleanScorePreviewDeferred = { resolve, reject };
        });
        delete job.cleanScorePreviewDeferred;
        job.status = 'processing';
        console.log(`[job ${jobId}] clean_score preview completed`);

        if (job.cleanScorePreviewAction === 'redo_font_strip') {
          job.cleanScorePreviewAction = undefined;
          await fs.unlink(cleanScorePath).catch(() => {});
          continue;
        }
        break;
      }

      if (enablePymupdfReview) {
        setJobProgress(job, {
          phase: 'upload',
          current: 1,
          total: 1,
          detail: 'PyMuPDF로 가사·메타 문자 추출 중 (검토용)…',
        });
        console.log(`[job ${jobId}] Running extract_text.py (font_separator review) using ${pythonBin}`);
        const { stdout, stderr } = await exec(
          `"${pythonBin}" "${scriptExtract}" "${inputPdfPath}" "${pymupdfReviewPath}"`,
        );
        if (stdout) console.log(`[job ${jobId}] extract_text.py Output:\n${stdout}`);
        if (stderr) console.error(`[job ${jobId}] extract_text.py Error:\n${stderr}`);
      }

      if (!fsSync.existsSync(lyricManifestPath)) {
        setJobProgress(job, {
          phase: 'separator',
          current: 1,
          total: 1,
          detail: 'pdfplumber·PyMuPDF 검토 결과 병합 중…',
        });
        const mergeArgs = [
          `"${pythonBin}"`,
          `"${scriptMergeLyrics}"`,
          `"${extractedJsonPath}"`,
          `"${lyricManifestPath}"`,
          `--output-flat "${ocrJsonPath}"`,
        ];
        if (fsSync.existsSync(pymupdfReviewPath)) {
          mergeArgs.push(`--pymupdf-review "${pymupdfReviewPath}"`);
        }
        console.log(`[job ${jobId}] Running merge_lyric_sources.py (initial auto-merge)`);
        const { stdout: mOut, stderr: mErr } = await exec(mergeArgs.join(' '));
        if (mOut) console.log(`[job ${jobId}] merge_lyric_sources.py Output:\n${mOut}`);
        if (mErr?.trim()) console.warn(`[job ${jobId}] merge_lyric_sources.py stderr:\n${mErr}`);
        const stripCfgPath = fontStripConfigPath(sessionRoot);
        if (fsSync.existsSync(lyricManifestPath) && fsSync.existsSync(stripCfgPath)) {
          try {
            const manifest = JSON.parse(await fs.readFile(lyricManifestPath, 'utf8')) as Record<string, unknown>;
            manifest.fontStrip = JSON.parse(await fs.readFile(stripCfgPath, 'utf8'));
            await fs.writeFile(lyricManifestPath, JSON.stringify(manifest, null, 2), 'utf8');
          } catch {
            /* optional metadata */
          }
        }
        await syncScoreTitlePersistence(sessionRoot, lyricManifestPath);
        await attachPartLabelsToManifest(sessionRoot, lyricManifestPath, job);

        console.log(`[job ${jobId}] Pausing for lyric_manifest.json save…`);
        job.status = 'lyric_manifest_save_needed';
        await new Promise<void>((resolve, reject) => {
          job.lyricManifestSaveDeferred = { resolve, reject };
        });
        delete job.lyricManifestSaveDeferred;
        job.status = 'processing';
        console.log(`[job ${jobId}] lyric_manifest save step completed`);
      } else {
        console.log(`[job ${jobId}] Existing lyric_manifest.json found. Skipping initial auto-merge to preserve previous lyric edits.`);
      }
      }
    } else {
      // pymupdf_review — 기존 마스킹 파이프라인 (1단계 full만)
      if (startStage !== 'full') {
        await fail({
          status: 400,
          error: 'PyMuPDF 마스킹 모드는 1단계(원본 PDF)만 지원합니다',
          detail: '2단계 이후는 「폰트 크기 분리」 방식을 사용하세요.',
        });
        return;
      }
      setJobProgress(job, {
        phase: 'upload',
        current: 1,
        total: 1,
        detail: 'PDF에서 문자 추출 중 (PyMuPDF / RapidOCR)…',
      });

      console.log(`[job ${jobId}] Running extract_text.py using ${pythonBin}`);
      const { stdout, stderr } = await exec(
        `"${pythonBin}" "${scriptExtract}" "${inputPdfPath}" "${ocrJsonPath}"`,
      );
      if (stdout) console.log(`[job ${jobId}] extract_text.py Output:\n${stdout}`);
      if (stderr) console.error(`[job ${jobId}] extract_text.py Error:\n${stderr}`);

      if (fsSync.existsSync(ocrJsonPath)) {
        const ocrData = JSON.parse(await fs.readFile(ocrJsonPath, 'utf8'));
        console.log(`[job ${jobId}] Pausing for UI review…`);
        job.status = 'review_needed';
        job.reviewData = ocrData;
        await new Promise<void>((resolve, reject) => {
          job.reviewDeferred = { resolve, reject };
        });
        console.log(`[job ${jobId}] Review completed, resuming…`);
        job.status = 'processing';
      }

      setJobProgress(job, {
        phase: 'audiveris',
        current: 0,
        total: pageHint,
        detail: resolveOmrEngine() === 'ai' ? 'PDF 마스킹 및 OMR 준비 중…' : 'PDF 마스킹 및 Audiveris 준비 중…',
      });

      if (fsSync.existsSync(ocrJsonPath)) {
        console.log(`[job ${jobId}] Running mask_pdf.py using ${pythonBin}`);
        await exec(
          `"${pythonBin}" "${scriptMask}" "${inputPdfPath}" "${maskedPdfPath}" "${ocrJsonPath}"`,
        );
      }
    }

    let importedMxlFromZip = false;
    if (
      startStage === 'full' &&
      job.resumeOmrWorkZipPath &&
      fsSync.existsSync(job.resumeOmrWorkZipPath)
    ) {
      setJobProgress(job, {
        phase: 'hitl',
        current: 0,
        total: pageHint,
        detail: '기존 OMR 검토 ZIP에서 MXL 불러오는 중 (Audiveris 생략)…',
      });
      console.log(
        `[job ${jobId}] full + omr-work.zip: lyric pipeline kept, Audiveris OMR skipped`,
      );
      const mxlPath = await bootstrapFromOmrWorkZip(
        job,
        job.resumeOmrWorkZipPath,
        outBase,
        pythonBin,
        { mxlOnly: true },
      );
      outputs = [mxlPath];
      mxlForInject = [mxlPath];
      importedMxlFromZip = true;
      pauseForAudiverisReview = job.pauseAfterAudiveris;
      for (const p of mxlForInject) {
        await ensureAudiverisRawBackup(p, job.sessionRoot);
        if (job.enableOmrStaffReview === false) {
          await postprocessAudiverisMxlInScoreFile(p, pythonBin, job.sessionRoot);
        } else {
          await restoreScoreFileFromAudiverisRaw(job.sessionRoot, p);
        }
      }
    }

    if (!importedMxlFromZip) {
    const audiverisInput = resolveAudiverisInputPdfPath(job);
    const pdfToProcess = audiverisInput?.path ?? inputPdfPath;

    setJobProgress(job, {
      phase: 'audiveris',
      current: 0,
      total: pageHint,
      detail:
        resolveOmrEngine() === 'pdftomusic'
          ? audiverisInput?.kind === 'clean_score'
            ? 'clean_score_only.pdf → PDFtoMusic Pro 인식 중…'
            : 'PDFtoMusic Pro 악보 인식 중…'
          : resolveOmrEngine() === 'ai'
            ? audiverisInput?.kind === 'clean_score'
              ? 'clean_score_only.pdf → AI OMR 인식 중…'
              : 'AI OMR 인식 중…'
            : audiverisInput?.kind === 'clean_score'
              ? 'clean_score_only.pdf → Audiveris 악보 인식 중…'
              : 'Audiveris 악보 인식 중…',
    });

    const omrEngine = resolveOmrEngine();
    const p2mpBin = resolveP2mpBin();
    console.log(
      `[job ${jobId}] Running ${omrEngine} OMR on ${pdfToProcess} (pipeline=${pipelineMode})…`,
    );

    const result = await runOmrEngine({
      audiverisBin,
      p2mpBin,
      pythonBin,
      outputBaseDir: outBase,
      inputPdfPath: pdfToProcess,
      onStreamLine: (_stream, line) => {
        const parsed = parseAudiverisProgressLine(line, job.pdfPageCount ?? 0);
        if (parsed) {
          setJobProgress(jobs.get(jobId), {
            phase: 'audiveris',
            current: parsed.current,
            total: parsed.total,
            detail:
              omrEngine === 'pdftomusic'
                ? 'PDFtoMusic Pro 처리'
                : omrEngine === 'ai'
                  ? 'AI OMR 처리'
                  : 'Audiveris 처리',
          });
        }
      },
    });

    outputs =
      result.mxlPaths.length > 0 ? result.mxlPaths : await collectMusicXmlOutputs(outBase);

    mxlForInject = outputs.filter((p) => p.toLowerCase().endsWith('.mxl'));

    const autoPauseFromAudiverisLog =
      omrEngine === 'audiveris' &&
      audiverisLogSuggestsHumanReview(result.stdout, result.stderr);
    if (autoPauseFromAudiverisLog) {
      console.log(
        `[job ${jobId}] AUDIVERIS_PAUSE_ON_WARN: 로그에 WARN 등이 감지되어 Audiveris 보정(HITL) 단계로 전환합니다.`,
      );
    }
    pauseForAudiverisReview = job.pauseAfterAudiveris || autoPauseFromAudiverisLog;

    for (const p of mxlForInject) {
      await ensureAudiverisRawBackup(p, job.sessionRoot);
      if (job.enableOmrStaffReview === false) {
        await postprocessAudiverisMxlInScoreFile(p, pythonBin, job.sessionRoot);
      } else {
        await restoreScoreFileFromAudiverisRaw(job.sessionRoot, p);
      }
    }
    }
    }

    // Audiveris가 점을 <dot> 없이 duration에만 반영해 내보내는 경우(미리보기에 "없던 점")를
    // 검토 전에 자동 정규화 — 마디 길이 초과분만 보수적으로 줄인다.
    if (skipAudiverisEngine) {
      for (const p of mxlForInject) {
        await ensureAudiverisRawBackup(p, job.sessionRoot);
        if (job.enableOmrStaffReview !== false) {
          await restoreScoreFileFromAudiverisRaw(job.sessionRoot, p);
        }
      }
    }

    if (startStage !== 'lyric_inject') {
      await enterOmrStaffHitlPhase(
        job,
        jobId,
        mxlForInject,
        pythonBin,
        scriptExtract,
        scriptMergeLyrics,
      );
    }

    if (outputs.length > 0 && pauseForAudiverisReview && mxlForInject.length > 0) {
      job.preInjectMxlPaths = [...mxlForInject];
      console.log(`[job ${jobId}] Pausing for Audiveris 결과 보정…`);
      job.status = 'audiveris_review_needed';
      await new Promise<void>((resolve, reject) => {
        job.audiverisReviewDeferred = { resolve, reject };
      });
      delete job.audiverisReviewDeferred;
      const useOverride =
        job.injectMxlPathsOverride &&
        job.injectMxlPathsOverride.length > 0 &&
        job.injectMxlPathsOverride.every((p) => fsSync.existsSync(p));
      mxlForInject = useOverride
        ? job.injectMxlPathsOverride!
        : [...(job.preInjectMxlPaths ?? [])];
      delete job.injectMxlPathsOverride;
      job.status = 'processing';
      console.log(`[job ${jobId}] Audiveris 보정 단계 이후 주입 재개...`);
    }

    // Pause for PyMuPDF lyric review AFTER OMR HITL edits are finished
    if (enablePymupdfReview && (pipelineMode === 'font_separator' || startStage === 'lyric_inject')) {
      let reviewReady = false;
      let ocrData: unknown[] = [];

      if (startStage === 'lyric_inject') {
        reviewReady = await ensurePymupdfReviewPayload({
          pymupdfReviewPath,
          lyricManifestPath,
          inputPdfPath,
          sessionRoot,
          pythonBin,
          scriptExtract,
        });
        if (reviewReady) {
          ocrData = JSON.parse(await fs.readFile(pymupdfReviewPath, 'utf8')) as unknown[];
        }
      } else {
        const items = await preparePostOmrLyricReviewItems(
          job,
          pythonBin,
          scriptExtract,
          scriptMergeLyrics,
        );
        if (items) {
          reviewReady = true;
          ocrData = items;
        }
      }

      if (reviewReady) {
        setJobProgress(job, {
          phase: 'separator',
          current: 0,
          total: 0,
          detail: '가사 검증·편집 대기…',
        });
        console.log(`[job ${jobId}] Pausing for PyMuPDF lyric review (font_separator) AFTER OMR HITL…`);
        job.status = 'review_needed';
        job.reviewAfterOmr = true;
        job.reviewData = ocrData;
        await new Promise<void>((resolve, reject) => {
          job.reviewDeferred = { resolve, reject };
        });
        console.log(`[job ${jobId}] PyMuPDF review completed, merging final lyric sources…`);
        job.status = 'processing';

        if (startStage === 'lyric_inject') {
          try {
            const updatedItems = JSON.parse(await fs.readFile(pymupdfReviewPath, 'utf8'));
            const manifest = JSON.parse(await fs.readFile(lyricManifestPath, 'utf8')) as Record<string, unknown>;
            manifest.items = updatedItems;
            await fs.writeFile(lyricManifestPath, JSON.stringify(manifest, null, 2), 'utf8');
            await syncScoreTitlePersistence(sessionRoot, lyricManifestPath);
            console.log(`[job ${jobId}] Updated lyric_manifest.json directly with submitted review items.`);
          } catch (e) {
            console.error('[job] Failed to update lyric_manifest.json directly', e);
          }
        } else {
          // Run merge_lyric_sources.py again to generate final lyric_manifest.json and ocr_data.json
          await ensureExtractedMusicTextJson(sessionRoot, {
            inputPdfPath: resolveLyricReviewPdfPath(job),
            pythonBin,
            scriptSeparator,
          });
          setJobProgress(job, {
            phase: 'separator',
            current: 1,
            total: 1,
            detail: 'pdfplumber·PyMuPDF 검토 결과 병합 중…',
          });
          const mergeArgs = [
            `"${pythonBin}"`,
            `"${scriptMergeLyrics}"`,
            `"${extractedJsonPath}"`,
            `"${lyricManifestPath}"`,
            `--output-flat "${ocrJsonPath}"`,
          ];
          if (fsSync.existsSync(pymupdfReviewPath)) {
            mergeArgs.push(`--pymupdf-review "${pymupdfReviewPath}"`);
          }
          console.log(`[job ${jobId}] Running merge_lyric_sources.py (final merge)`);
          const { stdout: mOut, stderr: mErr } = await exec(mergeArgs.join(' '));
          if (mOut) console.log(`[job ${jobId}] merge_lyric_sources.py Output:\n${mOut}`);
          if (mErr?.trim()) console.warn(`[job ${jobId}] merge_lyric_sources.py stderr:\n${mErr}`);
          const stripCfgPath = fontStripConfigPath(sessionRoot);
          if (fsSync.existsSync(lyricManifestPath) && fsSync.existsSync(stripCfgPath)) {
            try {
              const manifest = JSON.parse(await fs.readFile(lyricManifestPath, 'utf8')) as Record<string, unknown>;
              manifest.fontStrip = JSON.parse(await fs.readFile(stripCfgPath, 'utf8'));
              await fs.writeFile(lyricManifestPath, JSON.stringify(manifest, null, 2), 'utf8');
            } catch {
              /* optional metadata */
            }
          }
          await syncScoreTitlePersistence(sessionRoot, lyricManifestPath);
          await attachPartLabelsToManifest(sessionRoot, lyricManifestPath, job);
        }
      } else {
        const pdfPath = resolveLyricReviewPdfPath(job);
        const skipDetail = !pdfPath
          ? '가사 검증 생략 — 원본 PDF(input.pdf) 없음. omr-work ZIP에 input.pdf를 넣거나 원본 PDF를 업로드하세요.'
          : '가사 검증 생략 — PyMuPDF 추출 데이터 없음(lyric_manifest.json 또는 원본 PDF 확인).';
        console.warn(`[job ${jobId}] PyMuPDF lyric review skipped: ${skipDetail}`);
        setJobProgress(job, {
          phase: 'separator',
          current: 0,
          total: 0,
          detail: skipDetail,
        });
      }
    }

    const injectJsonPath = fsSync.existsSync(lyricManifestPath)
      ? lyricManifestPath
      : fsSync.existsSync(ocrJsonPath)
        ? ocrJsonPath
        : null;

    if (injectJsonPath === lyricManifestPath) {
      await syncScoreTitlePersistence(sessionRoot, lyricManifestPath);
    }

    const finalizeMxlPaths = [
      ...new Set(
        [...mxlForInject, ...outputs].filter(
          (p): p is string => typeof p === 'string' && p.toLowerCase().endsWith('.mxl'),
        ),
      ),
    ];
    if (finalizeMxlPaths.length > 0) {
      setJobProgress(job, {
        phase: 'audiveris',
        current: pageHint,
        total: pageHint,
        detail: '최종 MXL 후처리(쉼표·피아노 timeline·조표) 중…',
      });
      for (const p of finalizeMxlPaths) {
        await postprocessAudiverisMxlInScoreFile(p, pythonBin, job.sessionRoot);
      }
    }

    if (mxlForInject.length > 0 && injectJsonPath && pipelineMode !== 'audiveris_only') {
      setJobProgress(job, {
        phase: 'audiveris',
        current: pageHint,
        total: pageHint,
        detail: '인식된 가사와 메타데이터 주입 중…',
      });

      const scriptInject = path.join(__dirname, '..', 'scripts', 'inject_ocr.py');
      for (const p of mxlForInject) {
        if (p.toLowerCase().endsWith('.mxl')) {
          console.log(`[job ${jobId}] Running inject_ocr.py for ${p} using ${pythonBin}`);
          const { stdout: stdoutInj, stderr: stderrInj } = await exec(
            `"${pythonBin}" "${scriptInject}" "${p}" "${p}" "${injectJsonPath}"`,
          );
          if (stdoutInj) console.log(`[job ${jobId}] inject_ocr.py Output:\n${stdoutInj}`);
          if (stderrInj) console.error(`[job ${jobId}] inject_ocr.py Error:\n${stderrInj}`);
        }
      }
    }

    const scorePathsForLabels = collectScorePathsForLabeling(outputs, mxlForInject);
    if (scorePathsForLabels.length > 0) {
      for (const p of scorePathsForLabels) {
        await applyPartLabelsToScoreFile(job.sessionRoot, p, pythonBin);
      }
    }

    if (outputs.length === 0) {
      const omrEngineFinal = resolveOmrEngine();
      await fail({
        status: 422,
        error:
          startStage === 'omr_hitl'
            ? 'OMR 검토 ZIP에서 MXL을 불러오지 못했습니다'
            : omrEngineFinal === 'pdftomusic'
            ? 'PDFtoMusic Pro가 MusicXML/MXL을 만들지 못했습니다'
            : omrEngineFinal === 'ai'
              ? 'AI OMR이 MusicXML/MXL을 만들지 못했습니다'
              : 'Audiveris가 MusicXML/MXL을 만들지 못했습니다',
        detail:
          startStage === 'omr_hitl'
            ? 'ZIP에 review.mxl 또는 audiveris_raw.mxl이 있는지 확인하세요.'
            : omrEngineFinal === 'pdftomusic'
            ? pdftomusicFailureDetail()
            : omrEngineFinal === 'ai'
              ? aiOmrFailureDetail()
              : 'Audiveris 출력 폴더에 .mxl/.musicxml이 없습니다. 로그의 WARN [#N]·ERS 등은 보통 해당 장 처리 내보내기 문제를 뜻하며, 한 장이라도 실패하면 파일이 없을 수 있습니다. Audiveris GUI로 동일 PDF를 열어 오류를 확인하거나 디버그 ZIP의 로그를 검토하세요.',
      });
      return;
    }

    const baseName = resolveDownloadBaseName(job);

    if (!isDebug && outputs.length === 1) {
      const p = outputs[0];
      job.result = {
        kind: 'single',
        filePath: p,
        downloadBaseName: baseName,
        ext: path.extname(p),
      };
    } else {
      const zipName = isDebug ? `${baseName}-debug.zip` : `${baseName}-parts.zip`;
      job.result = {
        kind: 'zip',
        finalOutputs: outputs,
        isDebug,
        uploadedPdfPath: inputPdfPath,
        uploadedPdfZipName: path.basename(originalName),
        zipName,
      };
    }

    job.status = 'completed';
    job.finishedAt = Date.now();
    delete job.progress;
    console.log(`[job ${jobId}] Completed`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await fail({ status: 500, error: '변환 중 오류', detail: msg });
    console.error(`[job ${jobId}]`, e);
  }
}

app.post('/api/convert', async (req, res) => {
  const omr = omrEngineConfigured();
  const bin = resolveAudiverisBin() || '';
  if (omr.engine === 'ai') {
    const aiDeps = await probeAiOmrDeps(resolvePythonBin());
    if (!aiDeps.ok) {
      res.status(503).json({
        error: 'AI OMR dependencies are not ready',
        detail:
          aiDeps.hint ||
          `Install Python deps (pip install -r requirements.txt). Missing: ${aiDeps.missing.join(', ')}`,
      });
      return;
    }
  } else if (omr.engine === 'pdftomusic') {
    const p2mDeps = await probePdfToMusicDeps();
    if (!p2mDeps.ok) {
      res.status(503).json({
        error: 'PDFtoMusic Pro (p2mp) is not ready',
        detail: p2mDeps.hint || p2mpInstallHint(),
      });
      return;
    }
  } else if (!bin) {
    res.status(503).json({
      error: 'AUDIVERIS_BIN is not set',
      detail: 'Linux: export AUDIVERIS_BIN=/opt/audiveris/bin/Audiveris  (레거시: OMR_ENGINE=audiveris)',
    });
    return;
  }

  const ct = req.headers['content-type'] || '';
  if (!ct.toLowerCase().includes('multipart/form-data')) {
    res
      .status(400)
      .json({ error: 'Content-Type은 multipart/form-data 여야 합니다 (필드 pdf, 선택 debug)' });
    return;
  }

  let sessionRoot: string;
  try {
    sessionRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), 'pdf2mxl-up-'));
  } catch (_e) {
    res.status(500).json({ error: '임시 업로드 폴더를 만들 수 없습니다' });
    return;
  }

  const jobId = randomUUID();

  jobs.set(jobId, {
    status: 'pending',
    sessionRoot,
    originalName: 'input.pdf',
    isDebug: false,
    createdAt: Date.now(),
  });
  /** 202는 multipart·파일 저장이 끝난 뒤에만 보냅니다(조기 202 시 일부 브라우저·프록시에서 본문 전송이 멈춤). */

  let receiveSettled = false;
  const failReceive = (payload: JobErrorPayload) => {
    if (receiveSettled) return;
    receiveSettled = true;
    const job = jobs.get(jobId);
    if (job) {
      void fs.rm(job.sessionRoot, { recursive: true, force: true }).catch(() => {});
      jobs.delete(jobId);
    }
    if (!res.headersSent) {
      const code =
        payload.status >= 400 && payload.status < 600 ? payload.status : 400;
      res.status(code).json({
        error: payload.error,
        detail: payload.detail,
        exitCode: payload.exitCode,
        stdoutTail: payload.stdoutTail,
        stderrTail: payload.stderrTail,
      });
    }
  };

  let debugField = false;
  let pauseAfterAudiverisField = false;
  let pipelineModeField: PipelineMode = 'font_separator';
  let enablePymupdfReviewField = true;
  let enableOmrStaffReviewField = true;
  let startStageField: StartStage = 'full';
  let sawPdfField = false;
  let uploadChain: Promise<void> = Promise.resolve();

  const bb = busboy({
    headers: req.headers,
    defParamCharset: 'utf8',
    limits: { fileSize: MAX_UPLOAD_BYTES },
  });

  bb.on('field', (name, val) => {
    if (name === 'debug' && val === 'true') debugField = true;
    if (name === 'pauseAfterAudiveris' && val === 'true') pauseAfterAudiverisField = true;
    if (name === 'startStage') {
      startStageField = parseStartStage(String(val));
    }
    if (name === 'pipelineMode') {
      const v = String(val).trim();
      if (v === 'audiveris_only' || v === 'pymupdf_review' || v === 'font_separator') {
        pipelineModeField = v;
      }
    }
    if (name === 'enablePymupdfReview') {
      enablePymupdfReviewField = val === 'true' || val === '1';
    }
    if (name === 'enableOmrStaffReview') {
      enableOmrStaffReviewField = val === 'true' || val === '1';
    }
  });

  bb.on('file', (name, file, info) => {
    const job = jobs.get(jobId);
    if (!job) {
      file.resume();
      return;
    }

    const queueUpload = (destPath: string, onSaved?: (j: JobRecord) => void) => {
      const ws = createWriteStream(destPath);
      file.on('limit', () => {
        failReceive({
          status: 400,
          error: '파일이 너무 큽니다',
          detail: `최대 ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB`,
        });
      });
      uploadChain = uploadChain.then(() =>
        pipeline(file, ws)
          .then(() => {
            const j = jobs.get(jobId);
            if (!j || receiveSettled) return;
            onSaved?.(j);
          })
          .catch((e) =>
            failReceive({
              status: 500,
              error: '업로드 저장 실패',
              detail: e instanceof Error ? e.message : String(e),
            }),
          ),
      );
    };

    if (name === 'pdf') {
      if (sawPdfField) {
        file.resume();
        return;
      }
      sawPdfField = true;
      const diskName = safeUploadBasename(info.filename);
      const destPath = path.join(sessionRoot, diskName);
      job.originalName = decodeMultipartFilename(info.filename);
      rememberSourcePdfDisplayName(job, job.originalName);
      setJobProgress(job, {
        phase: 'upload',
        current: 0,
        total: 1,
        detail: 'PDF 파일 저장 중…',
      });
      queueUpload(destPath, (j) => {
        j.inputPdfPath = destPath;
        setJobProgress(j, {
          phase: 'upload',
          current: 1,
          total: 1,
          detail: '업로드 완료, 변환 준비 중…',
        });
      });
      return;
    }

    if (name === 'cleanScorePdf') {
      const dest = sessionResumeCleanScoreUploadPath(sessionRoot);
      const uploadedName = decodeMultipartFilename(info.filename);
      queueUpload(dest, (j) => {
        j.resumeCleanScorePath = dest;
        if (!j.sourcePdfDisplayName) {
          rememberSourcePdfDisplayName(j, uploadedName);
        }
      });
      return;
    }

    if (name === 'lyricManifest') {
      const dest = sessionResumeLyricManifestUploadPath(sessionRoot);
      queueUpload(dest, (j) => {
        j.resumeLyricManifestPath = dest;
      });
      return;
    }

    if (name === 'omrWorkZip') {
      const dest = sessionResumeOmrWorkZipPath(sessionRoot);
      queueUpload(dest, (j) => {
        j.resumeOmrWorkZipPath = dest;
      });
      return;
    }

    if (name === 'correctedMxl') {
      const dest = sessionResumeCorrectedMxlPath(sessionRoot);
      queueUpload(dest, (j) => {
        j.resumeCorrectedMxlPath = dest;
      });
      return;
    }

    file.resume();
  });

  bb.on('error', (e) => {
    failReceive({
      status: 400,
      error: 'multipart 처리 오류',
      detail: e instanceof Error ? e.message : String(e),
    });
  });

  bb.on('finish', () => {
    void uploadChain.then(() => {
      if (receiveSettled) return;
      const job = jobs.get(jobId);
      if (!job) return;
      if (!sawPdfField && startStageField !== 'omr_hitl' && startStageField !== 'lyric_inject') {
        const cleanScoreOnly =
          startStageField === 'clean_score' &&
          job.resumeCleanScorePath &&
          fsSync.existsSync(job.resumeCleanScorePath);
        if (!cleanScoreOnly) {
          failReceive({
            status: 400,
            error: 'pdf 파일 필드가 필요합니다',
            detail: 'multipart field name: pdf',
          });
          return;
        }
      }
      if (!job.inputPdfPath && startStageField !== 'omr_hitl' && startStageField !== 'lyric_inject') {
        if (
          startStageField === 'clean_score' &&
          job.resumeCleanScorePath &&
          fsSync.existsSync(job.resumeCleanScorePath)
        ) {
          job.inputPdfPath = job.resumeCleanScorePath;
          if (!job.sourcePdfDisplayName) {
            rememberSourcePdfDisplayName(job, path.basename(job.resumeCleanScorePath));
          }
          if (!job.originalName || job.originalName === 'input.pdf') {
            job.originalName = path.basename(job.resumeCleanScorePath) || 'clean_score_only.pdf';
          }
        } else {
          failReceive({
            status: 500,
            error: '업로드가 완료되지 않았습니다',
          });
          return;
        }
      }
      if (startStageField === 'omr_hitl' && !job.resumeOmrWorkZipPath) {
        failReceive({
          status: 400,
          error: 'OMR 검토 작업 ZIP이 필요합니다',
          detail: '시작 단계가 「OMR 검토 이어하기」일 때 omrWorkZip 파일을 함께 업로드하세요.',
        });
        return;
      }
      if (startStageField === 'clean_score') {
        if (!job.resumeCleanScorePath) {
          failReceive({
            status: 400,
            error: 'clean_score_only.pdf가 필요합니다',
            detail: '2단계는 clean_score_only.pdf를 업로드하세요.',
          });
          return;
        }
        if (!job.resumeLyricManifestPath) {
          failReceive({
            status: 400,
            error: '분리된 가사 JSON이 필요합니다',
            detail: '2단계는 1단계에서 만든 lyric_manifest.json(가사)을 함께 업로드하세요.',
          });
          return;
        }
      }
      if (startStageField === 'lyric_inject') {
        if (!job.resumeOmrWorkZipPath) {
          failReceive({
            status: 400,
            error: 'OMR 검토 작업 ZIP이 필요합니다',
            detail: '4단계는 omr-work.zip을 업로드하세요.',
          });
          return;
        }
        if (!job.resumeLyricManifestPath) {
          failReceive({
            status: 400,
            error: '가사 JSON 파일이 필요합니다',
            detail: '4단계는 편집 중인 가사 JSON을 함께 업로드하세요.',
          });
          return;
        }
      }
      if (
        startStageField === 'clean_score' &&
        pipelineModeField === 'font_separator' &&
        !job.resumeCleanScorePath &&
        !job.inputPdfPath
      ) {
        failReceive({
          status: 400,
          error: 'clean_score_only.pdf가 필요합니다',
          detail: '2단계는 clean_score_only.pdf와 lyric_manifest.json을 함께 업로드하세요.',
        });
        return;
      }
      if (startStageField === 'lyric_inject') {
        enablePymupdfReviewField = true;
      }
      job.isDebug = debugField;
      job.pauseAfterAudiveris = pauseAfterAudiverisField;
      job.pipelineMode = pipelineModeField;
      job.enablePymupdfReview = enablePymupdfReviewField;
      job.enableOmrStaffReview = enableOmrStaffReviewField;
      job.startStage = startStageField;
      if (!res.headersSent) {
        res.setHeader('X-Accel-Buffering', 'no');
        res.setHeader('X-Pdf2Mxl-Async', '202-after-upload');
        res.status(202).json({ jobId, message: '작업이 접수되었습니다' });
      }
      void executeJob(jobId, bin);
    });
  });

  req.on('error', (e) => {
    failReceive({
      status: 400,
      error: '업로드 연결 오류',
      detail: e instanceof Error ? e.message : String(e),
    });
  });

  req.pipe(bb);
});

app.get('/api/status/:jobId', (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: '알 수 없는 작업입니다' });
    return;
  }

  if (job.status === 'failed' && job.error) {
    const { status, ...body } = job.error;
    res.status(200).json({
      status: job.status,
      httpError: status,
      ...(job.progress ? { progress: job.progress } : {}),
      ...body,
    });
    return;
  }

  const payload: {
    status: JobStatus;
    progress?: JobProgress;
    reviewAfterOmr?: boolean;
    reviewPreservesEdits?: boolean;
    hasSavedLyricReview?: boolean;
  } = {
    status: job.status,
  };
  if (job.status === 'review_needed' && job.reviewAfterOmr) {
    payload.reviewAfterOmr = true;
    payload.reviewPreservesEdits = Boolean(job.reviewPreservesEdits);
    payload.hasSavedLyricReview =
      job.hasSavedLyricReview ?? fsSync.existsSync(sessionOcrPymupdfSavedPath(job.sessionRoot));
  }
  if (job.progress && JOB_STATUSES_WITH_PROGRESS.has(job.status)) {
    payload.progress = job.progress;
  }
  res.json(payload);
});

function streamZipToResponse(res: express.Response, result: Extract<JobResult, { kind: 'zip' }>): void {
  res.setHeader('Content-Type', 'application/zip');
  const zipAscii = result.zipName.replace(/[^\x20-\x7E]/g, '_');
  const zipEncoded = encodeURIComponent(result.zipName);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${zipAscii}"; filename*=UTF-8''${zipEncoded}`,
  );

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err: Error) => {
    if (!res.headersSent) res.status(500).end(String(err));
  });
  archive.pipe(res);

  if (result.isDebug && result.uploadedPdfPath && fsSync.existsSync(result.uploadedPdfPath)) {
    const zipPdfName = result.uploadedPdfZipName?.trim() || path.basename(result.uploadedPdfPath);
    archive.file(result.uploadedPdfPath, { name: zipPdfName });
  }

  const addedFiles = new Set<string>();
  for (const p of result.finalOutputs) {
    if (!addedFiles.has(p)) {
      archive.file(p, { name: path.basename(p) });
      addedFiles.add(p);
    }
  }

  void (async () => {
    try {
      await archive.finalize();
    } catch (err) {
      if (!res.headersSent) res.status(500).end(String(err));
    }
  })();
}

app.get('/api/download/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: '알 수 없는 작업입니다' });
    return;
  }
  if (job.status !== 'completed' || !job.result) {
    res.status(409).json({ error: '변환이 아직 끝나지 않았거나 실패했습니다' });
    return;
  }

  if (job.result.kind === 'single') {
    const { filePath, downloadBaseName, ext } = job.result;
    res.setHeader('Content-Type', 'application/octet-stream');
    const asciiName = `${downloadBaseName}${ext}`.replace(/[^\x20-\x7E]/g, '_');
    const encodedName = encodeURIComponent(`${downloadBaseName}${ext}`);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
    );
    const rs = fsSync.createReadStream(filePath);
    rs.on('error', () => {
      if (!res.headersSent) res.status(500).end('read error');
    });
    rs.pipe(res);
    return;
  }

  streamZipToResponse(res, job.result);
});

app.get('/api/diagnostic/:jobId/summary', async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!diagnosticJobsAllowed(job)) {
    res
      .status(404)
      .json({ error: '마스킹·인식 점검을 할 수 있는 작업이 아니거나 만료되었습니다' });
    return;
  }
  const maskedPdfPath = sessionMaskedPdfPath(job.sessionRoot);
  const cleanScorePath = sessionCleanScorePdfPath(job.sessionRoot);
  const inputPdfPath =
    job.inputPdfPath && fsSync.existsSync(job.inputPdfPath)
      ? job.inputPdfPath
      : fsSync.existsSync(cleanScorePath)
        ? cleanScorePath
        : null;
  if (!inputPdfPath) {
    res.status(404).json({ error: '비교용 PDF가 세션에 없습니다 (omr-work.zip에 PDF 포함 또는 clean_score 업로드)' });
    return;
  }
  const maskedExists = fsSync.existsSync(maskedPdfPath);
  const cleanScoreExists = fsSync.existsSync(cleanScorePath);
  const audiverisInput = resolveAudiverisInputPdfPath(job);
  const [origCount, maskedCount, cleanCount] = await Promise.all([
    pdfPageCountViaPython(inputPdfPath),
    maskedExists ? pdfPageCountViaPython(maskedPdfPath) : Promise.resolve(null),
    cleanScoreExists ? pdfPageCountViaPython(cleanScorePath) : Promise.resolve(null),
  ]);
  const pageCountForUi = origCount ?? cleanCount ?? maskedCount ?? job.pdfPageCount ?? 1;
  const mxlPath = resolvePrimaryMxlPathForInspect(job);
  let lyricManifestStats: Record<string, unknown> | undefined;
  const manifestPath = path.join(job.sessionRoot, 'lyric_manifest.json');
  if (fsSync.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
        matchStats?: Record<string, unknown>;
        v?: number;
      };
      lyricManifestStats = manifest.matchStats;
    } catch {
      /* ignore */
    }
  }
  res.json({
    jobId: req.params.jobId,
    status: job.status,
    originalName: job.originalName,
    pipelineMode: job.pipelineMode ?? 'font_separator',
    originalPdf: { exists: true, pageCount: origCount },
    maskedPdf: { exists: maskedExists, pageCount: maskedExists ? maskedCount : null },
    cleanScorePdf: { exists: cleanScoreExists, pageCount: cleanScoreExists ? cleanCount : null },
    audiverisInputPdf: audiverisInput?.kind ?? null,
    lyricManifestStats,
    pageCountForUi: Math.max(1, pageCountForUi),
    pageCountsMatch:
      (!maskedExists && !cleanScoreExists) ||
      origCount == null ||
      (maskedExists && maskedCount != null && origCount === maskedCount) ||
      (cleanScoreExists && cleanCount != null && origCount === cleanCount),
    scoreMusicXmlAvailable: Boolean(mxlPath),
  });
});

app.get('/api/diagnostic/:jobId/page/:pageNum/png', async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!diagnosticJobsAllowed(job)) {
    res.status(404).end();
    return;
  }
  const sourceRaw = String(req.query.source ?? 'original');
  const source =
    sourceRaw === 'masked' ? 'masked' : sourceRaw === 'clean_score' ? 'clean_score' : 'original';
  const page = parseInt(req.params.pageNum, 10);
  const dpiRaw = parseInt(String(req.query.dpi ?? '132'), 10);
  const dpi = Number.isFinite(dpiRaw) ? Math.min(240, Math.max(72, dpiRaw)) : 132;

  const maskedPdfPath = sessionMaskedPdfPath(job.sessionRoot);
  const cleanScorePath = sessionCleanScorePdfPath(job.sessionRoot);
  const inputPdfPath =
    job.inputPdfPath && fsSync.existsSync(job.inputPdfPath) ? job.inputPdfPath : null;
  const pdfPath =
    source === 'masked'
      ? maskedPdfPath
      : source === 'clean_score'
        ? cleanScorePath
        : inputPdfPath ?? cleanScorePath;
  if (!pdfPath || !fsSync.existsSync(pdfPath)) {
    res.status(404).end();
    return;
  }

  const count = await pdfPageCountViaPython(pdfPath);
  if (!count || !Number.isFinite(page) || page < 1 || page > count) {
    res.status(400).json({ error: '페이지 번호가 범위를 벗어났습니다' });
    return;
  }

  try {
    const cacheDir = path.join(job.sessionRoot, '.diag-cache');
    await fs.mkdir(cacheDir, { recursive: true });
    const cacheFile = path.join(cacheDir, `p${page}-${source}-dpi${dpi}-rgb-v2.png`);
    let needRender = true;
    if (fsSync.existsSync(cacheFile)) {
      const [stPdf, stPng] = await Promise.all([fs.stat(pdfPath), fs.stat(cacheFile)]);
      if (stPng.mtimeMs >= stPdf.mtimeMs) needRender = false;
    }
    try {
      const st = fsSync.statSync(cacheFile);
      if (st.size < 64) needRender = true;
    } catch {
      needRender = true;
    }
    if (needRender) {
      const script = path.join(__dirname, '..', 'scripts', 'pdf_diagnostic.py');
      const pythonBin = resolvePythonBin();
      await exec(
        `"${pythonBin}" "${script}" render "${pdfPath}" ${page} "${cacheFile}" ${dpi}`,
        { maxBuffer: 32 * 1024 * 1024 },
      );
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=120');
    res.sendFile(path.resolve(cacheFile));
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: String(e) });
  }
});

app.get('/api/diagnostic/:jobId/score-musicxml', async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!diagnosticJobsAllowed(job)) {
    res.status(404).json({ error: '점검 대상 작업이 아닙니다' });
    return;
  }
  const mxlPath = resolvePrimaryMxlPathForInspect(job);
  if (!mxlPath) {
    res.status(404).json({ error: 'MXL/MusicXML 파일을 찾을 수 없습니다' });
    return;
  }
  try {
    const pythonBin = resolvePythonBin();
    const cacheDir = path.join(job.sessionRoot, '.diag-cache');
    await fs.mkdir(cacheDir, { recursive: true });
    const outXml = path.join(cacheDir, 'inspect-score.musicxml');
    // OMR HITL: raw+HITL만 — fix_audiveris_mxl·rest 정규화는 적용하지 않음
    if (job.status === 'omr_staff_review_needed') {
      await syncOmrReviewMxl(job.sessionRoot, mxlPath, pythonBin);
    } else {
      await fixAudiverisMxlInScoreFile(mxlPath, pythonBin, job.sessionRoot);
    }
    if (fsSync.existsSync(outXml)) await fs.unlink(outXml).catch(() => {});
    const mxlScript = path.join(__dirname, '..', 'scripts', 'mxl_to_musicxml_file.py');
    await exec(`"${pythonBin}" "${mxlScript}" "${mxlPath}" "${outXml}"`, {
      maxBuffer: 40 * 1024 * 1024,
    });
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.resolve(outXml), (err) => {
      if (err && !res.headersSent) res.status(500).json({ error: String(err) });
    });
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: String(e) });
  }
});

app.get('/api/diagnostic/:jobId/masked-pdf', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!diagnosticJobsAllowed(job)) {
    res.status(404).json({ error: '마스킹·인식 점검을 할 수 있는 작업이 아니거나 만료되었습니다' });
    return;
  }
  const maskedPdfPath = sessionMaskedPdfPath(job.sessionRoot);
  if (!fsSync.existsSync(maskedPdfPath)) {
    res.status(404).json({
      error:
        'masked_input.pdf가 없습니다. OCR·마스킹 단계가 없었거나, 아직 생성되지 않았을 수 있습니다.',
    });
    return;
  }
  const attachment =
    req.query.download === '1' ||
    req.query.download === 'true' ||
    String(req.query.disposition ?? '').toLowerCase() === 'attachment';
  sendDiagnosticSessionPdf(
    res,
    maskedPdfPath,
    diagnosticPdfDownloadBaseName(job, 'masked'),
    attachment,
  );
});

app.get('/api/diagnostic/:jobId/original-pdf', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!diagnosticJobsAllowed(job)) {
    res.status(404).json({ error: '마스킹·인식 점검을 할 수 있는 작업이 아니거나 만료되었습니다' });
    return;
  }
  const inputPdfPath = job.inputPdfPath;
  if (!inputPdfPath || !fsSync.existsSync(inputPdfPath)) {
    res.status(404).json({ error: '업로드 원본 PDF가 세션에 없습니다' });
    return;
  }
  const attachment =
    req.query.download === '1' ||
    req.query.download === 'true' ||
    String(req.query.disposition ?? '').toLowerCase() === 'attachment';
  sendDiagnosticSessionPdf(
    res,
    inputPdfPath,
    diagnosticPdfDownloadBaseName(job, 'original'),
    attachment,
  );
});

app.get('/api/diagnostic/:jobId/clean-score-pdf', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!diagnosticJobsAllowed(job)) {
    res.status(404).json({ error: '마스킹·인식 점검을 할 수 있는 작업이 아니거나 만료되었습니다' });
    return;
  }
  const cleanScorePath = sessionCleanScorePdfPath(job.sessionRoot);
  if (!fsSync.existsSync(cleanScorePath)) {
    res.status(404).json({
      error:
        'clean_score_only.pdf가 없습니다. 폰트 분리(font_separator) 파이프라인을 사용하지 않았거나 아직 생성되지 않았을 수 있습니다.',
    });
    return;
  }
  const attachment =
    req.query.download === '1' ||
    req.query.download === 'true' ||
    String(req.query.disposition ?? '').toLowerCase() === 'attachment';
  sendDiagnosticSessionPdf(
    res,
    cleanScorePath,
    diagnosticPdfDownloadBaseName(job, 'clean_score'),
    attachment,
  );
});

/** 마스킹·점검 작업 세션에서 Audiveris `-step` 배치 실행 (`-save`, `-export` 없음). 서버 부하 가능 — 필요 시만 사용. */
app.post('/api/diagnostic/:jobId/audiveris-step-probe', express.json({ limit: '48kb' }), async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!audiverisStepProbeJobsAllowed(job)) {
    res.status(404).json({
      error:
        'Audiveris 단계 실행을 할 수 있는 작업이 아니거나 세션이 만료되었습니다. 완료·실패·Audiveris 보정 대기 상태의 jobId만 가능합니다.',
    });
    return;
  }
  const bin = resolveAudiverisBin();
  if (!bin) {
    res.status(503).json({ error: 'AUDIVERIS_BIN이 설정되어 있지 않습니다.' });
    return;
  }

  const body = req.body as {
    step?: unknown;
    force?: unknown;
    sheets?: unknown;
    pdfSource?: unknown;
  };
  const stepRaw = typeof body.step === 'string' ? body.step.trim() : '';
  if (!isAudiverisSheetStep(stepRaw)) {
    res.status(400).json({
      error: '유효하지 않은 step입니다.',
      steps: [...AUDIVERIS_SHEET_STEPS],
    });
    return;
  }

  let sheetsTokens: string[] = [];
  try {
    sheetsTokens = parseAudiverisSheetsSpec(typeof body.sheets === 'string' ? body.sheets : undefined);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    return;
  }

  const force = body.force === true || body.force === 'true';
  const pdfSourceRaw = typeof body.pdfSource === 'string' ? body.pdfSource.trim() : '';
  const pdfRequested: 'clean_score' | 'masked' | 'original' =
    pdfSourceRaw === 'original'
      ? 'original'
      : pdfSourceRaw === 'masked'
        ? 'masked'
        : pdfSourceRaw === 'clean_score'
          ? 'clean_score'
          : 'clean_score';

  const maskedPdfPath = sessionMaskedPdfPath(job.sessionRoot);
  const cleanScorePath = sessionCleanScorePdfPath(job.sessionRoot);
  const origPath = job.inputPdfPath;

  let pdfPath: string | null = null;
  let pdfUsed: 'clean_score' | 'masked' | 'original' = 'original';
  let note: string | undefined;

  const tryClean = () => {
    if (fsSync.existsSync(cleanScorePath)) {
      pdfPath = cleanScorePath;
      pdfUsed = 'clean_score';
      return true;
    }
    return false;
  };
  const tryMasked = () => {
    if (fsSync.existsSync(maskedPdfPath)) {
      pdfPath = maskedPdfPath;
      pdfUsed = 'masked';
      return true;
    }
    return false;
  };
  const tryOrig = () => {
    if (origPath && fsSync.existsSync(origPath)) {
      pdfPath = origPath;
      pdfUsed = 'original';
      return true;
    }
    return false;
  };

  if (pdfRequested === 'clean_score') {
    if (!tryClean()) {
      if (tryMasked()) note = 'clean_score_only.pdf가 없어 masked_input.pdf로 실행했습니다.';
      else if (tryOrig()) note = 'clean_score_only.pdf가 없어 업로드 원본 PDF로 실행했습니다.';
    }
  } else if (pdfRequested === 'masked') {
    if (!tryMasked()) {
      if (tryClean()) note = 'masked_input.pdf가 없어 clean_score_only.pdf로 실행했습니다.';
      else if (tryOrig()) note = '마스킹 PDF가 없어 업로드 원본 PDF로 실행했습니다.';
    }
  } else if (!tryOrig()) {
    if (tryClean()) note = '원본 PDF를 찾지 못해 clean_score_only.pdf로 실행했습니다.';
    else tryMasked();
  }

  if (!pdfPath) {
    res.status(404).json({
      error: 'Audiveris에 넘길 PDF(clean_score·masked·original)를 찾을 수 없습니다.',
    });
    return;
  }

  const runId = randomUUID();
  const runRoot = path.join(job.sessionRoot, 'audiveris-step-probes', runId);
  await fs.mkdir(runRoot, { recursive: true });

  const argv = buildAudiverisStepProbeArgv({
    outputDir: runRoot,
    inputPdfPath: pdfPath,
    step: stepRaw,
    force,
    sheetsTokens,
  });

  try {
    const result = await runAudiverisArgv({
      audiverisBin: bin,
      argv,
      maxCaptureBytesPerStream: AUDIVERIS_STEP_PROBE_CAPTURE_BYTES,
    });
    const artifacts = await collectAudiverisStepProbeArtifacts(runRoot);
    res.json({
      runId,
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      argv,
      pdfRequested,
      pdfUsed,
      note,
      artifacts,
    });
  } catch (e) {
    if (!res.headersSent) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
        runId,
      });
    }
  }
});

/** `POST .../audiveris-step-probe` 결과 폴더 안 파일 다운로드. `rel`은 해당 실행 폴더 기준 상대 경로(예: `subdir/book.omr`). */
app.get('/api/diagnostic/:jobId/audiveris-step-probe/:runId/download', async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!audiverisStepProbeJobsAllowed(job)) {
    res.status(404).json({ error: '작업을 찾을 수 없거나 단계 실행 결과에 접근할 수 없습니다.' });
    return;
  }
  const runRoot = path.join(job.sessionRoot, 'audiveris-step-probes', req.params.runId);
  if (!fsSync.existsSync(runRoot)) {
    res.status(404).json({ error: '해당 실행(runId) 폴더가 없습니다.' });
    return;
  }
  const rel = req.query.rel;
  if (typeof rel !== 'string' || !rel.trim()) {
    res.status(400).json({ error: '쿼리 rel(상대 경로)이 필요합니다.' });
    return;
  }
  const abs = artifactPathWithinRunRoot(runRoot, rel);
  if (!abs || !fsSync.existsSync(abs)) {
    res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    return;
  }
  try {
    const st = await fs.stat(abs);
    if (!st.isFile()) {
      res.status(400).json({ error: '파일만 다운로드할 수 있습니다.' });
      return;
    }
    const base = path.basename(abs);
    const ascii = base.replace(/[^\x20-\x7E]/g, '_') || 'artifact';
    const encoded = encodeURIComponent(base);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
    );
    res.sendFile(path.resolve(abs), (err) => {
      if (err && !res.headersSent) res.status(500).json({ error: String(err) });
    });
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: String(e) });
  }
});

app.use('/api/crops', (req, res, next) => {
  const match = req.path.match(/^\/([^\/]+)\/(.*)$/);
  if (!match) return next();
  const jobId = match[1];
  const filename = match[2];
  const job = jobs.get(jobId);
  if (!job) return res.status(404).end();
  const filePath = path.join(job.sessionRoot, 'crops', filename);
  res.sendFile(filePath);
});

app.get('/api/font-strip/:jobId', async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: '알 수 없는 작업입니다' });
    return;
  }
  if (job.status !== 'font_strip_needed') {
    res.status(400).json({ error: '폰트 크기 선택 단계가 아닙니다' });
    return;
  }
  try {
    const statsPath = fontStripStatsPath(job.sessionRoot);
    if (fsSync.existsSync(statsPath)) {
      const stats = JSON.parse(await fs.readFile(statsPath, 'utf8'));
      res.json(stats);
      return;
    }
    if (job.fontStripStats) {
      res.json(job.fontStripStats);
      return;
    }
    res.status(404).json({ error: '폰트 통계가 준비되지 않았습니다' });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/font-strip/:jobId', express.json({ limit: '256kb' }), async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: '알 수 없는 작업입니다' });
    return;
  }
  if (job.status !== 'font_strip_needed' || !job.fontStripDeferred) {
    res.status(400).json({ error: '폰트 크기 선택 대기 상태가 아닙니다' });
    return;
  }
  const ranges = parseFontStripRangesBody(req.body);
  if (!ranges) {
    res.status(400).json({ error: '{ "ranges": [{ "minPt": number, "maxPt": number }] } 형식이 필요합니다' });
    return;
  }
  try {
    await fs.writeFile(
      fontStripConfigPath(job.sessionRoot),
      JSON.stringify({ ranges, savedAt: new Date().toISOString() }, null, 2),
      'utf8',
    );
    job.fontStripDeferred.resolve();
    delete job.fontStripDeferred;
    delete job.fontStripStats;
    res.json({ ok: true, ranges });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

async function renderSessionPagePng(
  job: JobRecord,
  pdfPath: string,
  page: number,
  dpi: number,
  cacheTag: string,
): Promise<string> {
  const cacheDir = path.join(job.sessionRoot, '.diag-cache');
  await fs.mkdir(cacheDir, { recursive: true });
  const cacheFile = path.join(cacheDir, `p${page}-${cacheTag}-dpi${dpi}-rgb-v2.png`);
  let needRender = true;
  if (fsSync.existsSync(cacheFile)) {
    const [stPdf, stPng] = await Promise.all([fs.stat(pdfPath), fs.stat(cacheFile)]);
    if (stPng.mtimeMs >= stPdf.mtimeMs) needRender = false;
  }
  try {
    const st = fsSync.statSync(cacheFile);
    if (st.size < 64) needRender = true;
  } catch {
    needRender = true;
  }
  if (needRender) {
    const script = path.join(__dirname, '..', 'scripts', 'pdf_diagnostic.py');
    const pythonBin = resolvePythonBin();
    await exec(
      `"${pythonBin}" "${script}" render "${pdfPath}" ${page} "${cacheFile}" ${dpi}`,
      { maxBuffer: 32 * 1024 * 1024 },
    );
  }
  return cacheFile;
}

app.get('/api/clean-score-preview/:jobId', async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!cleanScorePreviewJobsAllowed(job)) {
    res.status(400).json({ error: 'clean_score 미리보기 단계가 아닙니다' });
    return;
  }
  const inputPdfPath = job.inputPdfPath;
  const cleanScorePath = sessionCleanScorePdfPath(job.sessionRoot);
  if (!inputPdfPath || !fsSync.existsSync(inputPdfPath) || !fsSync.existsSync(cleanScorePath)) {
    res.status(404).json({ error: '미리보기 PDF가 준비되지 않았습니다' });
    return;
  }
  const [origCount, cleanCount] = await Promise.all([
    pdfPageCountViaPython(inputPdfPath),
    pdfPageCountViaPython(cleanScorePath),
  ]);
  let ranges: FontStripRangeDto[] = [];
  let scoreTitle: ScoreTitleDto | null = null;
  const cfgPath = fontStripConfigPath(job.sessionRoot);
  if (fsSync.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(await fs.readFile(cfgPath, 'utf8')) as {
        ranges?: FontStripRangeDto[];
        scoreTitle?: ScoreTitleDto;
      };
      ranges = cfg.ranges ?? [];
      if (cfg.scoreTitle?.text?.trim()) scoreTitle = cfg.scoreTitle;
    } catch {
      /* ignore */
    }
  }
  const extractedJsonPath = path.join(job.sessionRoot, 'extracted_music_text.json');
  const scriptSeparator = path.join(__dirname, '..', 'scripts', 'pdf_separator.py');
  const pythonBin = resolvePythonBin();
  let titleCandidate: ScoreTitleDto | null = null;
  if (fsSync.existsSync(extractedJsonPath)) {
    titleCandidate = await detectScoreTitleCandidate(pythonBin, scriptSeparator, extractedJsonPath);
  }
  res.json({
    jobId: req.params.jobId,
    originalName: job.originalName,
    pageCount: Math.max(1, origCount ?? cleanCount ?? 1),
    ranges,
    replaceTripletPua: process.env.CLEAN_SCORE_REPLACE_TRIPLET_PUA === '1',
    scoreTitle,
    titleCandidate,
  });
});

app.get('/api/clean-score-preview/:jobId/page/:pageNum/png', async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!cleanScorePreviewJobsAllowed(job)) {
    res.status(404).end();
    return;
  }
  const sourceRaw = String(req.query.source ?? 'original');
  const source = sourceRaw === 'clean_score' ? 'clean_score' : 'original';
  const page = parseInt(req.params.pageNum, 10);
  const dpiRaw = parseInt(String(req.query.dpi ?? '132'), 10);
  const dpi = Number.isFinite(dpiRaw) ? Math.min(240, Math.max(72, dpiRaw)) : 132;
  const inputPdfPath = job.inputPdfPath;
  const cleanScorePath = sessionCleanScorePdfPath(job.sessionRoot);
  const pdfPath = source === 'clean_score' ? cleanScorePath : inputPdfPath;
  if (!pdfPath || !fsSync.existsSync(pdfPath)) {
    res.status(404).end();
    return;
  }
  const count = await pdfPageCountViaPython(pdfPath);
  if (!count || !Number.isFinite(page) || page < 1 || page > count) {
    res.status(400).json({ error: '페이지 번호가 범위를 벗어났습니다' });
    return;
  }
  try {
    const cacheFile = await renderSessionPagePng(job, pdfPath, page, dpi, `${source}-preview`);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=120');
    res.sendFile(path.resolve(cacheFile));
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: String(e) });
  }
});

app.get('/api/clean-score-preview/:jobId/pdf', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!cleanScorePreviewJobsAllowed(job)) {
    res.status(400).json({ error: 'clean_score 미리보기 단계가 아닙니다' });
    return;
  }
  const cleanScorePath = sessionCleanScorePdfPath(job.sessionRoot);
  if (!fsSync.existsSync(cleanScorePath)) {
    res.status(404).json({ error: 'clean_score_only.pdf가 없습니다' });
    return;
  }
  const attachment =
    req.query.download === '1' ||
    req.query.download === 'true' ||
    String(req.query.disposition ?? '').toLowerCase() === 'attachment';
  sendDiagnosticSessionPdf(
    res,
    cleanScorePath,
    diagnosticPdfDownloadBaseName(job, 'clean_score'),
    attachment,
  );
});

app.post('/api/clean-score-preview/:jobId/score-title', express.json({ limit: '64kb' }), async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!cleanScorePreviewJobsAllowed(job)) {
    res.status(400).json({ error: 'clean_score 미리보기 단계가 아닙니다' });
    return;
  }
  const body = req.body as {
    text?: unknown;
    bbox?: unknown;
    page?: unknown;
    mask?: unknown;
    applyMask?: unknown;
  };
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    res.status(400).json({ error: '제목 텍스트가 필요합니다' });
    return;
  }
  const cfg = await readFontStripConfig(job.sessionRoot);
  const prev = (cfg.scoreTitle ?? {}) as ScoreTitleDto;
  let bbox = prev.bbox;
  if (Array.isArray(body.bbox) && body.bbox.length >= 4) {
    const nums = body.bbox.map((v) => Number(v));
    if (nums.every((n) => Number.isFinite(n))) {
      bbox = [nums[0], nums[1], nums[2], nums[3]];
    }
  }
  if (!bbox) {
    const extractedJsonPath = path.join(job.sessionRoot, 'extracted_music_text.json');
    const scriptSeparator = path.join(__dirname, '..', 'scripts', 'pdf_separator.py');
    const pythonBin = resolvePythonBin();
    const cand = await detectScoreTitleCandidate(pythonBin, scriptSeparator, extractedJsonPath);
    if (cand?.bbox) bbox = cand.bbox;
  }
  const pageNum =
    Number.isFinite(Number(body.page)) ? Math.max(1, Math.round(Number(body.page))) : (prev.page ?? 1);
  const scoreTitle: ScoreTitleDto = {
    text,
    page: pageNum,
    bbox,
    mask: body.mask === false ? false : true,
    detected: prev.detected,
  };
  cfg.scoreTitle = scoreTitle;
  await writeFontStripConfig(job.sessionRoot, cfg);
  const applyMask = body.applyMask !== false;
  const cleanScorePath = sessionCleanScorePdfPath(job.sessionRoot);
  if (applyMask && scoreTitle.mask !== false && fsSync.existsSync(cleanScorePath)) {
    try {
      const pythonBin = resolvePythonBin();
      const scriptSeparator = path.join(__dirname, '..', 'scripts', 'pdf_separator.py');
      await applyScoreTitleMaskOnPdf(
        pythonBin,
        scriptSeparator,
        job.sessionRoot,
        cleanScorePath,
        scoreTitle,
      );
    } catch (e) {
      res.status(500).json({ error: `제목 영역 마스킹 실패: ${String(e)}` });
      return;
    }
  }
  res.json({ ok: true, scoreTitle });
});

app.post('/api/clean-score-preview/:jobId/continue', express.json(), (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'clean_score_preview_needed' || !job.cleanScorePreviewDeferred) {
    res.status(400).json({ error: 'clean_score 미리보기 대기 상태가 아닙니다' });
    return;
  }
  job.cleanScorePreviewAction = 'continue';
  job.cleanScorePreviewDeferred.resolve();
  delete job.cleanScorePreviewDeferred;
  res.json({ ok: true });
});

app.post('/api/clean-score-preview/:jobId/redo-font-strip', express.json(), (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'clean_score_preview_needed' || !job.cleanScorePreviewDeferred) {
    res.status(400).json({ error: 'clean_score 미리보기 대기 상태가 아닙니다' });
    return;
  }
  job.cleanScorePreviewAction = 'redo_font_strip';
  job.cleanScorePreviewDeferred.resolve();
  delete job.cleanScorePreviewDeferred;
  res.json({ ok: true });
});

app.get('/api/lyric-manifest/:jobId', async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!lyricManifestSaveJobsAllowed(job) && !lyricManifestDownloadJobsAllowed(job)) {
    res.status(404).json({ error: 'lyric_manifest.json을 저장할 수 있는 작업이 아니거나 아직 생성되지 않았습니다' });
    return;
  }
  const summary = await readLyricManifestSummary(job.sessionRoot);
  if (!summary) {
    res.status(404).json({ error: 'lyric_manifest.json이 없습니다' });
    return;
  }
  res.json({
    jobId: req.params.jobId,
    originalName: job.originalName,
    ...summary,
  });
});

app.get('/api/lyric-manifest/:jobId/download', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!lyricManifestDownloadJobsAllowed(job)) {
    res.status(404).json({ error: 'lyric_manifest.json을 내려받을 수 없습니다' });
    return;
  }
  const manifestPath = sessionLyricManifestPath(job.sessionRoot);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  setAttachmentFilenameHeader(res, lyricManifestDownloadBaseName(job));
  res.sendFile(path.resolve(manifestPath));
});

app.post('/api/lyric-manifest/:jobId/continue', express.json(), (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'lyric_manifest_save_needed' || !job.lyricManifestSaveDeferred) {
    res.status(400).json({ error: 'lyric_manifest 저장 대기 상태가 아닙니다' });
    return;
  }
  job.lyricManifestSaveDeferred.resolve();
  delete job.lyricManifestSaveDeferred;
  res.json({ ok: true });
});

app.get('/api/review/:jobId', (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: '알 수 없는 작업입니다' });
    return;
  }
  if (job.status !== 'review_needed' || !job.reviewData) {
    res.status(400).json({ error: '리뷰가 필요하지 않거나 준비되지 않았습니다' });
    return;
  }
  res.json(job.reviewData);
});

app.get('/api/review/:jobId/lyric-source-info', async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: '알 수 없는 작업입니다' });
    return;
  }
  const hasSaved =
    job.hasSavedLyricReview ?? fsSync.existsSync(sessionOcrPymupdfSavedPath(job.sessionRoot));
  const hasBaseline = fsSync.existsSync(sessionOcrPymupdfBaselinePath(job.sessionRoot));
  const preset = await readLabelsByIndexFromPath(sessionPartLabelsPresetPath(job.sessionRoot));
  const savedLabels = await readLabelsByIndexFromPath(sessionPartLabelsPath(job.sessionRoot));
  res.json({
    hasSavedLyricReview: hasSaved,
    hasBaseline,
    reviewPreservesEdits: Boolean(job.reviewPreservesEdits),
    partLabelsPreset: preset ?? undefined,
    partLabelsSaved: savedLabels ?? undefined,
  });
});

/** OMR·HITL 후 가사 검증 — 원본 PDF 1차 추출(제목·작곡·가사)로 되돌림 */
app.post('/api/review/:jobId/reset-lyrics-initial', async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: '알 수 없는 작업입니다' });
    return;
  }
  if (job.status !== 'review_needed' || !job.reviewData) {
    res.status(400).json({ error: '리뷰가 필요하지 않거나 준비되지 않았습니다' });
    return;
  }
  if (!job.reviewAfterOmr) {
    res.status(400).json({
      error: 'OMR·HITL 이후 가사 검증 단계에서만 초기화할 수 있습니다',
    });
    return;
  }
  const pdfPath = resolveLyricReviewPdfPath(job);
  if (!pdfPath) {
    res.status(404).json({ error: '원본 PDF가 세션에 없습니다' });
    return;
  }
  try {
    const pythonBin = resolvePythonBin();
    const scriptExtract = path.join(__dirname, '..', 'scripts', 'extract_text.py');
    const scriptMergeLyrics = path.join(__dirname, '..', 'scripts', 'merge_lyric_sources.py');
    const items = await ensureLyricReviewBaseline({
      sessionRoot: job.sessionRoot,
      pdfPath,
      pythonBin,
      scriptExtract,
      scriptMergeLyrics,
      forceRebuild: true,
    });
    await activateLyricReviewItems(job.sessionRoot, items);
    job.reviewData = items;
    job.reviewPreservesEdits = false;
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** OMR·HITL 후 가사 검증 — omr-work.zip에 저장된 가사 검증 편집 불러오기 */
app.post('/api/review/:jobId/load-saved-lyrics', async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: '알 수 없는 작업입니다' });
    return;
  }
  if (job.status !== 'review_needed' || !job.reviewData) {
    res.status(400).json({ error: '리뷰가 필요하지 않거나 준비되지 않았습니다' });
    return;
  }
  if (!job.reviewAfterOmr) {
    res.status(400).json({
      error: 'OMR·HITL 이후 가사 검증 단계에서만 불러올 수 있습니다',
    });
    return;
  }
  try {
    const items = applyReviewUiDefaultRoles(await loadSavedLyricReviewItems(job.sessionRoot));
    await activateLyricReviewItems(job.sessionRoot, items);
    job.reviewData = items;
    job.reviewPreservesEdits = true;
    job.hasSavedLyricReview = true;
    res.json(items);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

/** 문자 검토(리뷰) 단계: 원본 PDF 각 페이지 크기(pt) — 수동 가사 마스킹 좌표 변환 */
app.get('/api/review/:jobId/pdf-dimensions', async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'review_needed') {
    res.status(404).json({ error: '리뷰 준비 전이거나 작업을 찾을 수 없습니다' });
    return;
  }
  const inputPdfPath = resolveLyricReviewPdfPath(job);
  if (!inputPdfPath) {
    res.status(404).json({ error: '업로드 PDF가 세션에 없습니다' });
    return;
  }
  try {
    const script = path.join(__dirname, '..', 'scripts', 'pdf_diagnostic.py');
    const pythonBin = resolvePythonBin();
    const { stdout } = await exec(`"${pythonBin}" "${script}" pagesizes "${inputPdfPath}"`, {
      maxBuffer: 16 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout.trim()) as {
      pageCount?: number;
      pages?: Array<{ widthPt?: number; heightPt?: number }>;
    };
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/** 문자 검토 단계: 한 페이지 미리보기 PNG (PDF pt와 동일 세로방향 좌표) */
app.get('/api/review/:jobId/pdf-page-png/:pageNum', async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'review_needed') {
    res.status(404).json({ error: '리뷰 준비 전이거나 작업을 찾을 수 없습니다' });
    return;
  }
  const inputPdfPath = resolveLyricReviewPdfPath(job);
  if (!inputPdfPath) {
    res.status(404).json({ error: '업로드 PDF가 세션에 없습니다' });
    return;
  }
  const pageNum = parseInt(req.params.pageNum, 10);
  const dpiRaw = parseInt(String(req.query.dpi ?? '118'), 10);
  const dpi = Number.isFinite(dpiRaw) ? Math.min(200, Math.max(72, dpiRaw)) : 118;

  try {
    const diagScript = path.join(__dirname, '..', 'scripts', 'pdf_diagnostic.py');
    const pythonBin = resolvePythonBin();
    const infoOut = (
      await exec(`"${pythonBin}" "${diagScript}" info "${inputPdfPath}"`, {
        maxBuffer: 512 * 1024,
      })
    ).stdout.trim();
    const { pageCount } = JSON.parse(infoOut || '{}') as { pageCount?: number };
    if (
      pageCount == null ||
      pageCount < 1 ||
      !Number.isFinite(pageNum) ||
      pageNum < 1 ||
      pageNum > pageCount
    ) {
      res.status(400).json({ error: '페이지 번호가 범위를 벗어났습니다' });
      return;
    }

    const cacheDir = path.join(job.sessionRoot, '.review-ui-cache');
    await fs.mkdir(cacheDir, { recursive: true });
    const cacheFile = path.join(cacheDir, `p${pageNum}-dpi${dpi}-rgb-v2.png`);
    let needRender = true;
    try {
      if (fsSync.existsSync(cacheFile)) {
        const [stPdf, stPng] = await Promise.all([fs.stat(inputPdfPath), fs.stat(cacheFile)]);
        if (stPng.mtimeMs >= stPdf.mtimeMs && stPng.size > 64) needRender = false;
      }
    } catch {
      needRender = true;
    }

    if (needRender) {
      await exec(
        `"${pythonBin}" "${diagScript}" render "${inputPdfPath}" ${pageNum} "${cacheFile}" ${dpi}`,
        { maxBuffer: 32 * 1024 * 1024 },
      );
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=30');
    res.sendFile(path.resolve(cacheFile));
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: String(e) });
  }
});

/** 가사 검증 UI용 — 현재 score의 part/voice별 가사 대상 음표 수 */
app.get('/api/review/:jobId/note-counts', async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: '알 수 없는 작업입니다' });
    return;
  }
  const mxlPath = resolvePrimaryMxlPathForInspect(job);
  if (!mxlPath || !fsSync.existsSync(mxlPath)) {
    res.status(404).json({ error: '세션에 MusicXML이 없습니다' });
    return;
  }
  try {
    const pythonBin = resolvePythonBin();
    const script = path.join(__dirname, '..', 'scripts', 'count_attachable_notes.py');
    const { stdout } = await exec(`"${pythonBin}" "${script}" "${mxlPath}"`, {
      maxBuffer: 8 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout.trim() || '{}') as unknown;
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

function filterMxlLintReport(
  report: Record<string, unknown>,
  page: number | undefined,
  staff: string | undefined,
): Record<string, unknown> {
  let issues = Array.isArray(report.issues) ? [...report.issues] : [];
  if (page !== undefined && Number.isFinite(page)) {
    issues = issues.filter(
      (i) =>
        i &&
        typeof i === 'object' &&
        (i as { pageEstimate?: unknown }).pageEstimate === page,
    );
  }
  if (staff) {
    issues = issues.filter(
      (i) => i && typeof i === 'object' && (i as { staff?: unknown }).staff === staff,
    );
  }
  return { ...report, issues, issueCount: issues.length };
}

app.get('/api/diagnostic/:jobId/mxl-lint', async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!diagnosticJobsAllowed(job)) {
    res.status(404).json({ error: 'MXL lint를 조회할 수 있는 작업이 아닙니다' });
    return;
  }
  const mxlPath = resolvePrimaryMxlPathForInspect(job);
  if (!mxlPath) {
    res.status(404).json({ error: 'MXL/MusicXML 파일을 찾을 수 없습니다' });
    return;
  }
  const lintPath = sessionMxlLintPath(job.sessionRoot);
  const forceRegen =
    req.query.regen === '1' ||
    req.query.regen === 'true' ||
    String(req.query.refresh ?? '') === '1';
  const pageRaw = req.query.page;
  const staffRaw = typeof req.query.staff === 'string' ? req.query.staff.trim() : '';
  const page =
    pageRaw !== undefined && pageRaw !== ''
      ? parseInt(String(pageRaw), 10)
      : undefined;
  const staff = staffRaw || undefined;
  const measureOffsetPrinted =
    Number(process.env.MXL_MEASURE_OFFSET_PRINTED ?? '1') || 1;
  const pageCountHint = Math.max(1, job.pdfPageCount ?? 1);
  try {
    const pythonBin = resolvePythonBin();
    const labelsByIndex = await resolvePartLabelsByIndex(job.sessionRoot, job);
    let report: Record<string, unknown>;
    if (forceRegen || mxlLintNeedsRegeneration(job.sessionRoot) || !fsSync.existsSync(lintPath)) {
      report = await runMxlQualityLintForJob(job, mxlPath, pythonBin);
    } else {
      try {
        report = JSON.parse(await fs.readFile(lintPath, 'utf8')) as Record<string, unknown>;
      } catch {
        report = await runMxlQualityLintForJob(job, mxlPath, pythonBin);
      }
    }
    if (labelsByIndex?.length) {
      report = relabelLintReportStaff(report, labelsByIndex);
    }
    if (page !== undefined || staff) {
      report = filterMxlLintReport(
        report,
        Number.isFinite(page) ? page : undefined,
        staff,
      );
    }
    res.json(report);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    if (!res.headersSent) {
      res.status(200).json({
        issueCount: 0,
        issues: [],
        lintUnavailable: true,
        lintError: detail,
        measureOffsetPrinted,
        pageCount: pageCountHint,
        staffOrderHint: ['S', 'A', 'T', 'B', 'PR', 'PL'],
      });
    }
  }
});

app.get('/api/diagnostic/:jobId/omr-policy', async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!diagnosticJobsAllowed(job)) {
    res.status(404).json({ error: 'OMR 정책을 조회할 수 있는 작업이 아닙니다' });
    return;
  }
  const measureOffsetPrinted =
    Number(process.env.MXL_MEASURE_OFFSET_PRINTED ?? '1') || 1;
  const lintPath = path.join(job.sessionRoot, 'mxl_lint.json');
  let lintSummary: Record<string, unknown> | undefined;
  let pCauses: string[] | undefined;
  if (fsSync.existsSync(lintPath)) {
    try {
      const lint = JSON.parse(await fs.readFile(lintPath, 'utf8')) as {
        summary?: Record<string, unknown>;
        pCauses?: string[];
      };
      lintSummary = lint.summary;
      pCauses = Array.isArray(lint.pCauses) ? lint.pCauses : undefined;
    } catch {
      /* ignore */
    }
  }
  const ocrSpec = resolvedAudiverisOcrLangSpec();
  const printedMeasureMarkers = await readPrintedMeasureMarkersFromSession(
    job.sessionRoot,
    measureOffsetPrinted,
  );
  res.json({
    jobId: req.params.jobId,
    status: job.status,
    measureOffsetPrinted,
    printedMeasureMarkers,
    audiverisOcrLangEffective: ocrSpec,
    audiverisOcrLangConstantInjected: ocrLanguageConstantArgsFromEnv().length > 0,
    textEngineConstantsActive: audiverisTextEngineConstantArgsFromEnv().length > 0,
    cleanScoreConstantsActive: audiverisCleanScoreConstantArgsFromEnv().length > 0,
    audiverisCliExtraArgsCount: audiverisExtraCliArgsFromEnv().length,
    pCauses: pCauses ?? [
      'TEXTS(OCR)가 SYMBOLS 글리프를 선점 — Audiveris TextWord·OCR eng',
      '다성부 세로 정렬로 tuplet 숫자가 한 staff에만 붙음 — SYMBOLS/BEAMS',
      '마디 끝 8분 쉼표 — RHYTHMS 마디 채우기(heuristic)',
      '마디 경계 음 순서 — LINKS/RHYTHMS(heuristic)',
    ],
    lintSummary,
    hints: {
      printedMeasureFormula: '인쇄 마디 ≈ MusicXML measure@number + measureOffsetPrinted',
      symbolsUi: 'SYMBOLS 탭 오인식은 MXL 후처리만으로는 제거되지 않음 — Audiveris GUI·엔진',
      fixMxlScript: 'scripts/fix_audiveris_mxl.py — direction words P/9 등 일부',
    },
  });
});

app.get('/api/diagnostic/:jobId/score-parts', async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!diagnosticJobsAllowed(job)) {
    res.status(404).json({ error: '파트 목록을 조회할 수 있는 작업이 아닙니다' });
    return;
  }
  const mxlPath = resolvePrimaryMxlPathForInspect(job);
  if (!mxlPath) {
    res.status(404).json({ error: 'MXL 파일을 찾을 수 없습니다' });
    return;
  }
  try {
    const pythonBin = resolvePythonBin();
    const listed = await listScorePartsFromMxl(mxlPath, pythonBin);
    let preset: string[] | undefined;
    const presetPath = sessionPartLabelsPresetPath(job.sessionRoot);
    if (fsSync.existsSync(presetPath)) {
      try {
        const p = JSON.parse(await fs.readFile(presetPath, 'utf8')) as {
          labelsByIndex?: unknown;
        };
        if (Array.isArray(p.labelsByIndex)) {
          preset = p.labelsByIndex.map((x) => String(x).trim());
        }
      } catch {
        /* ignore */
      }
    }
    let saved: string[] | undefined;
    const labelsPath = sessionPartLabelsPath(job.sessionRoot);
    if (fsSync.existsSync(labelsPath)) {
      try {
        const s = JSON.parse(await fs.readFile(labelsPath, 'utf8')) as {
          labelsByIndex?: unknown;
        };
        if (Array.isArray(s.labelsByIndex)) {
          saved = s.labelsByIndex.map((x) => String(x).trim());
        }
      } catch {
        /* ignore */
      }
    }
    const partsRaw = listed.parts as Array<{
      index: number;
      id: string;
      name?: string;
      instrumentName?: string;
      suggestedLabel?: string;
    }>;
    const parts = partsRaw.map((p, i) => {
      const displayLabel = (
        saved?.[i]?.trim() ||
        preset?.[i]?.trim() ||
        p.suggestedLabel?.trim() ||
        `P${i + 1}`
      ).trim();
      return { ...p, displayLabel };
    });
    res.json({
      parts,
      presetLabelsByIndex: preset,
      savedLabelsByIndex: saved,
    });
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: String(e) });
  }
});

app.post('/api/part-labels/:jobId', express.json({ limit: '64kb' }), async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'part_labels_needed' || !job.partLabelsDeferred) {
    res.status(400).json({ error: '성부 라벨 지정 대기 상태가 아닙니다' });
    return;
  }
  const body = req.body as { labelsByIndex?: unknown };
  if (!Array.isArray(body.labelsByIndex) || body.labelsByIndex.length < 1) {
    res.status(400).json({ error: 'labelsByIndex 문자열 배열이 필요합니다' });
    return;
  }
  const labelsByIndex = body.labelsByIndex.map((x) => String(x ?? '').trim());
  if (labelsByIndex.some((l) => !l)) {
    res.status(400).json({ error: '모든 파트에 라벨을 지정해 주세요' });
    return;
  }
  try {
    const out = {
      version: 1,
      labelsByIndex,
      savedAt: new Date().toISOString(),
    };
    await fs.writeFile(sessionPartLabelsPath(job.sessionRoot), JSON.stringify(out, null, 2), 'utf8');
    job.partLabelsByIndex = labelsByIndex;
    const lintCache = sessionMxlLintPath(job.sessionRoot);
    if (fsSync.existsSync(lintCache)) {
      await fs.unlink(lintCache).catch(() => {});
    }
    job.partLabelsDeferred.resolve();
    delete job.partLabelsDeferred;
    res.json({ ok: true });
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: String(e) });
  }
});

app.get('/api/raw-mxl/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (
    !job ||
    (job.status !== 'audiveris_review_needed' &&
      job.status !== 'omr_staff_review_needed' &&
      job.status !== 'part_labels_needed') ||
    !job.preInjectMxlPaths?.length
  ) {
    res.status(404).json({ error: '원본 MXL을 내려받을 수 없는 상태입니다' });
    return;
  }
  const p = job.preInjectMxlPaths[0];
  if (!fsSync.existsSync(p)) {
    res.status(404).json({ error: 'MXL 파일이 없습니다' });
    return;
  }
  const asciiName = path.basename(p).replace(/[^\x20-\x7E]/g, '_') || 'audiveris-raw.mxl';
  const encoded = encodeURIComponent(path.basename(p) || 'audiveris-raw.mxl');
  res.setHeader('Content-Type', 'application/vnd.recordare.musicxml+xml');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`,
  );
  res.sendFile(path.resolve(p), (err) => {
    if (err && !res.headersSent) res.status(500).json({ error: String(err) });
  });
});

app.get('/api/omr-hitl/:jobId/fixes', async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!diagnosticJobsAllowed(job)) {
    res.status(404).json({ error: 'OMR HITL 보정을 조회할 수 있는 작업이 아닙니다' });
    return;
  }
  const fixesPath = sessionOmrHitlFixesPath(job.sessionRoot);
  try {
    if (!fsSync.existsSync(fixesPath)) {
      res.json({ version: 1, fixes: [] });
      return;
    }
    const raw = JSON.parse(await fs.readFile(fixesPath, 'utf8')) as { fixes?: unknown };
    res.json({
      version: 1,
      fixes: Array.isArray(raw.fixes) ? raw.fixes : [],
    });
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: String(e) });
  }
});

app.post('/api/omr-hitl/:jobId/fixes', express.json({ limit: '512kb' }), async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'omr_staff_review_needed') {
    res.status(400).json({ error: 'OMR 품질 검토 대기 중에만 보정을 저장할 수 있습니다' });
    return;
  }
  const body = req.body as { fixes?: unknown };
  if (!Array.isArray(body.fixes)) {
    res.status(400).json({ error: 'fixes 배열이 필요합니다' });
    return;
  }
  try {
    const payload = {
      version: 1,
      fixes: body.fixes,
      savedAt: new Date().toISOString(),
    };
    await fs.writeFile(sessionOmrHitlFixesPath(job.sessionRoot), JSON.stringify(payload, null, 2), 'utf8');
    res.json({ ok: true, count: body.fixes.length });
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: String(e) });
  }
});

app.get('/api/omr-hitl/:jobId/measure', async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!diagnosticJobsAllowed(job)) {
    res.status(404).json({ error: '마디 조회를 할 수 있는 작업이 아닙니다' });
    return;
  }
  const partId = typeof req.query.partId === 'string' ? req.query.partId.trim() : '';
  const measureMxl = typeof req.query.measureMxl === 'string' ? req.query.measureMxl.trim() : '';
  if (!partId || !measureMxl) {
    res.status(400).json({ error: 'partId, measureMxl 쿼리가 필요합니다' });
    return;
  }
  const mxlPath = resolvePrimaryMxlPathForInspect(job);
  if (!mxlPath) {
    res.status(404).json({ error: 'MXL 파일을 찾을 수 없습니다' });
    return;
  }
  const script = path.join(__dirname, '..', 'scripts', 'omr_hitl_measure_cli.py');
  const pythonBin = resolvePythonBin();
  try {
    const { stdout } = await exec(
      `"${pythonBin}" "${script}" "${mxlPath}" --part-id "${partId}" --measure "${measureMxl}"`,
      { maxBuffer: 4 * 1024 * 1024 },
    );
    res.json(JSON.parse(String(stdout).trim()));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!res.headersSent) res.status(500).json({ error: msg });
  }
});

app.post('/api/omr-hitl/:jobId/apply', async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'omr_staff_review_needed') {
    res.status(400).json({ error: 'OMR 품질 검토 대기 중에만 보정을 적용할 수 있습니다' });
    return;
  }
  const mxlPath = resolvePrimaryMxlPathForInspect(job);
  if (!mxlPath) {
    res.status(404).json({ error: 'MXL 파일을 찾을 수 없습니다' });
    return;
  }
  const pythonBin = resolvePythonBin();
  try {
    const stats = await syncOmrReviewMxl(job.sessionRoot, mxlPath, pythonBin);
    await invalidateInspectScoreCache(job.sessionRoot);
    let lintReport: Record<string, unknown> | null = null;
    try {
      lintReport = await runMxlQualityLintForJob(job, mxlPath, pythonBin);
    } catch (lintErr) {
      const msg = lintErr instanceof Error ? lintErr.message : String(lintErr);
      console.warn(`[job ${req.params.jobId}] mxl lint after HITL apply: ${msg}`);
    }
    res.json({
      ok: true,
      stats: {
        applied: stats.hitlApplied,
        skipped: stats.hitlSkipped,
        pendingCleared: stats.pendingCleared,
        syncMode: stats.syncMode,
      },
      postprocess: stats,
      lint: lintReport,
    });
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: String(e) });
  }
});

app.post('/api/omr-hitl/:jobId/normalize-rests', async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'omr_staff_review_needed') {
    res.status(400).json({ error: 'OMR 품질 검토 대기 중에만 자동 정리를 실행할 수 있습니다' });
    return;
  }
  const mxlPath = resolvePrimaryMxlPathForInspect(job);
  if (!mxlPath) {
    res.status(404).json({ error: 'MXL 파일을 찾을 수 없습니다' });
    return;
  }
  const pythonBin = resolvePythonBin();
  try {
    const stats = await runOmrHitlAutoNormalize(job.sessionRoot, mxlPath, pythonBin);
    await invalidateInspectScoreCache(job.sessionRoot);
    res.json({ ok: true, stats });
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: String(e) });
  }
});

app.post('/api/omr-hitl/:jobId/sync-preview', async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'omr_staff_review_needed') {
    res.status(400).json({ error: 'OMR 품질 검토 대기 중에만 미리보기를 동기화할 수 있습니다' });
    return;
  }
  const mxlPath = resolvePrimaryMxlPathForInspect(job);
  if (!mxlPath) {
    res.status(404).json({ error: 'MXL 파일을 찾을 수 없습니다' });
    return;
  }
  const pythonBin = resolvePythonBin();
  try {
    const stats = await syncOmrReviewMxl(job.sessionRoot, mxlPath, pythonBin);
    await invalidateInspectScoreCache(job.sessionRoot);
    res.json({ ok: true, stats });
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: String(e) });
  }
});

app.get('/api/omr-hitl/:jobId/export-work', async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'omr_staff_review_needed') {
    res.status(400).json({ error: 'OMR 품질 검토 대기 중에만 작업을 내보낼 수 있습니다' });
    return;
  }
  const mxlPath = resolvePrimaryMxlPathForInspect(job);
  if (!mxlPath || !fsSync.existsSync(mxlPath)) {
    res.status(404).json({ error: 'MXL 파일을 찾을 수 없습니다' });
    return;
  }
  try {
    const pythonBin = resolvePythonBin();
    await syncOmrReviewMxl(job.sessionRoot, mxlPath, pythonBin);
    await invalidateInspectScoreCache(job.sessionRoot);
  } catch (e) {
    res.status(500).json({ error: `저장 전 MXL 동기화 실패: ${String(e)}` });
    return;
  }
  const base = resolveDownloadBaseName(job);
  res.setHeader('Content-Type', 'application/zip');
  setAttachmentFilenameHeader(res, `${base}-omr-work.zip`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    if (!res.headersSent) res.status(500).json({ error: String(err) });
  });
  archive.pipe(res);
  archive.file(mxlPath, { name: 'review.mxl' });
  const rawPath = sessionAudiverisRawMxlPath(job.sessionRoot);
  if (fsSync.existsSync(rawPath)) archive.file(rawPath, { name: 'audiveris_raw.mxl' });
  const baselinePath = sessionHitlBaselineMxlPath(job.sessionRoot);
  if (fsSync.existsSync(baselinePath)) archive.file(baselinePath, { name: 'omr_hitl_baseline.mxl' });
  const fixesPath = sessionOmrHitlFixesPath(job.sessionRoot);
  if (fsSync.existsSync(fixesPath)) archive.file(fixesPath, { name: 'omr_hitl_fixes.json' });
  const labelsPath = sessionPartLabelsPath(job.sessionRoot);
  if (fsSync.existsSync(labelsPath)) archive.file(labelsPath, { name: 'part_labels.json' });
  const checkpointPath = sessionOmrHitlCheckpointPath(job.sessionRoot);
  if (fsSync.existsSync(checkpointPath)) archive.file(checkpointPath, { name: 'omr_hitl_checkpoint.json' });
  const cleanScorePath = sessionCleanScorePdfPath(job.sessionRoot);
  const pdfIncluded: { cleanScore?: boolean; input?: boolean } = {};
  if (fsSync.existsSync(cleanScorePath)) {
    archive.file(cleanScorePath, { name: 'clean_score_only.pdf' });
    pdfIncluded.cleanScore = true;
  }
  const inputPath = job.inputPdfPath;
  if (
    inputPath &&
    fsSync.existsSync(inputPath) &&
    (!pdfIncluded.cleanScore || path.resolve(inputPath) !== path.resolve(cleanScorePath))
  ) {
    archive.file(inputPath, { name: 'input.pdf' });
    pdfIncluded.input = true;
  }
  const lyricManifestPath = path.join(job.sessionRoot, 'lyric_manifest.json');
  const pymupdfReviewPath = path.join(job.sessionRoot, 'ocr_data_pymupdf.json');
  const extractedJsonPath = path.join(job.sessionRoot, 'extracted_music_text.json');
  if (fsSync.existsSync(lyricManifestPath)) {
    archive.file(lyricManifestPath, { name: 'lyric_manifest.json' });
  }
  const fontStripCfgPath = fontStripConfigPath(job.sessionRoot);
  if (fsSync.existsSync(fontStripCfgPath)) {
    archive.file(fontStripCfgPath, { name: 'font_strip_config.json' });
  }
  if (fsSync.existsSync(pymupdfReviewPath)) {
    archive.file(pymupdfReviewPath, { name: 'ocr_data_pymupdf.json' });
  }
  const lyricBaselinePath = sessionOcrPymupdfBaselinePath(job.sessionRoot);
  if (fsSync.existsSync(lyricBaselinePath)) {
    archive.file(lyricBaselinePath, { name: 'ocr_data_pymupdf_baseline.json' });
  }
  if (fsSync.existsSync(extractedJsonPath)) {
    archive.file(extractedJsonPath, { name: 'extracted_music_text.json' });
  }
  const displayPdfName =
    job.sourcePdfDisplayName ??
    readSourcePdfDisplayNameSync(job.sessionRoot) ??
    (isGenericPdfBasename(job.originalName) ? null : job.originalName);
  const manifest = {
    version: 2,
    exportedAt: new Date().toISOString(),
    jobId: job.id,
    originalName: displayPdfName ?? job.originalName,
    sourcePdfDisplayName: displayPdfName ?? undefined,
    pdfIncluded,
  };
  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
  await archive.finalize();
});

app.post('/api/omr-hitl/:jobId/import-work', async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'omr_staff_review_needed') {
    res.status(400).json({ error: 'OMR 품질 검토 대기 중에만 작업을 불러올 수 있습니다' });
    return;
  }
  const mxlPath = resolvePrimaryMxlPathForInspect(job);
  if (!mxlPath) {
    res.status(404).json({ error: 'MXL 파일을 찾을 수 없습니다' });
    return;
  }
  const bb = busboy({ headers: req.headers, limits: { fileSize: 80 * 1024 * 1024, files: 1 } });
  let zipPath: string | null = null;
  let importErr: string | null = null;
  bb.on('file', (_name, file, info) => {
    if (!info.filename.toLowerCase().endsWith('.zip')) {
      importErr = 'ZIP 파일만 업로드할 수 있습니다';
      file.resume();
      return;
    }
    zipPath = path.join(job.sessionRoot, `_import_${Date.now()}.zip`);
    const ws = createWriteStream(zipPath);
    file.pipe(ws);
  });
  bb.on('error', (err) => {
    importErr = String(err);
  });
  bb.on('finish', () => {
    void (async () => {
      if (importErr) {
        res.status(400).json({ error: importErr });
        return;
      }
      if (!zipPath || !fsSync.existsSync(zipPath)) {
        res.status(400).json({ error: '업로드된 ZIP이 없습니다' });
        return;
      }
      try {
        const extractDir = path.join(job.sessionRoot, `_import_extract_${Date.now()}`);
        const pythonBin = resolvePythonBin();
        await fs.mkdir(extractDir, { recursive: true });
        const extractPy = path.join(job.sessionRoot, '_extract_import_zip.py');
        await fs.writeFile(
          extractPy,
          'import zipfile, sys\nzipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])\n',
          'utf8',
        );
        await exec(`"${pythonBin}" "${extractPy}" "${zipPath}" "${extractDir}"`, {
          maxBuffer: 8 * 1024 * 1024,
        });
        await fs.unlink(extractPy).catch(() => {});
        const { fixCount, stats } = await importOmrWorkFromExtractDir(
          job.sessionRoot,
          extractDir,
          mxlPath,
          pythonBin,
          job,
        );
        await invalidateInspectScoreCache(job.sessionRoot);
        await fs.rm(extractDir, { recursive: true, force: true }).catch(() => {});
        await fs.unlink(zipPath).catch(() => {});
        res.json({
          ok: true,
          fixCount,
          stats,
        });
      } catch (e) {
        if (!res.headersSent) res.status(500).json({ error: String(e) });
      }
    })();
  });
  req.pipe(bb);
});

app.post('/api/continue-omr-staff-review/:jobId', (req, res) => {
  void (async () => {
    const job = jobs.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: '작업을 찾을 수 없습니다. 서버 재시작(pm2 restart) 후에는 변환을 처음부터 다시 시작하세요.',
      });
      return;
    }
    if (
      job.status === 'processing' ||
      job.status === 'audiveris_review_needed' ||
      job.status === 'completed'
    ) {
      res.json({ ok: true, alreadyContinued: true });
      return;
    }
    if (job.status !== 'omr_staff_review_needed' || !job.omrStaffReviewDeferred) {
      const hint =
        job.status === 'part_labels_needed'
          ? '성부 라벨 지정 모달에서 확정한 뒤 OMR 검토 단계로 넘어가세요.'
          : `현재 상태: ${job.status}`;
      res.status(400).json({ error: 'OMR 페이지·성부 검토 대기 상태가 아닙니다', detail: hint });
      return;
    }
    const pythonBin = resolvePythonBin();
    await applyOmrHitlFixesForJob(job, pythonBin);
    job.status = 'processing';
    job.omrStaffReviewDeferred.resolve();
    delete job.omrStaffReviewDeferred;
    res.json({ ok: true });
  })();
});

app.post('/api/continue-audiveris/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'audiveris_review_needed' || !job.audiverisReviewDeferred) {
    res.status(400).json({ error: 'Audiveris 보정 대기 상태가 아닙니다' });
    return;
  }
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (ct.includes('application/json')) {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => {
      void (async () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8').trim() || '{}';
          const parsed = JSON.parse(raw) as { transposeSemitones?: unknown };
          const ts =
            typeof parsed.transposeSemitones === 'number' &&
            Number.isFinite(parsed.transposeSemitones)
              ? Math.round(parsed.transposeSemitones)
              : 0;
          await mergeOcrMetaTranspose(job.sessionRoot, ts);
          job.injectMxlPathsOverride = [...(job.preInjectMxlPaths ?? [])];
          job.audiverisReviewDeferred!.resolve();
          delete job.audiverisReviewDeferred;
          res.json({ ok: true });
        } catch (e) {
          if (!res.headersSent) res.status(400).json({ error: String(e) });
        }
      })();
    });
    req.on('error', (e) => {
      if (!res.headersSent) res.status(400).json({ error: String(e) });
    });
    return;
  }
  if (ct.includes('multipart/form-data')) {
    const bb = busboy({
      headers: req.headers,
      defParamCharset: 'utf8',
      limits: { fileSize: MAX_UPLOAD_BYTES },
    });
    let tsStr = '0';
    let filePromise: Promise<void> = Promise.resolve();
    let sawMxl = false;
    bb.on('field', (name, val) => {
      if (name === 'transposeSemitones') tsStr = val;
    });
    bb.on('file', (name, file) => {
      if (name !== 'mxl') {
        file.resume();
        return;
      }
      sawMxl = true;
      const dest = path.join(job.sessionRoot, 'user_replaced_score.mxl');
      const ws = createWriteStream(dest);
      filePromise = filePromise.then(() => pipeline(file, ws));
    });
    bb.on('error', (e) => {
      if (!res.headersSent) res.status(400).json({ error: String(e) });
    });
    bb.on('finish', () => {
      void filePromise
        .then(async () => {
          const ts = parseInt(tsStr, 10);
          await mergeOcrMetaTranspose(job.sessionRoot, Number.isFinite(ts) ? ts : 0);
          const dest = path.join(job.sessionRoot, 'user_replaced_score.mxl');
          if (sawMxl && fsSync.existsSync(dest)) {
            job.injectMxlPathsOverride = [dest];
          } else {
            job.injectMxlPathsOverride = [...(job.preInjectMxlPaths ?? [])];
          }
          job.audiverisReviewDeferred!.resolve();
          delete job.audiverisReviewDeferred;
          res.json({ ok: true });
        })
        .catch((e) => {
          if (!res.headersSent) res.status(500).json({ error: String(e) });
        });
    });
    req.pipe(bb);
    return;
  }
  res.status(400).json({
    error: 'Content-Type은 application/json 또는 multipart/form-data 여야 합니다',
  });
});

app.post('/api/review/:jobId', express.json({ limit: '10mb' }), async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: '알 수 없는 작업입니다' });
    return;
  }
  if (job.status !== 'review_needed' || !job.reviewDeferred) {
    res.status(400).json({ error: '현재 작업이 리뷰 대기 상태가 아닙니다' });
    return;
  }

  try {
    const body = req.body;
    let items: unknown[];
    let transposeSemitones = 0;
    if (Array.isArray(body)) {
      items = body;
    } else if (
      body &&
      typeof body === 'object' &&
      Array.isArray((body as { items?: unknown[] }).items)
    ) {
      const o = body as { items: unknown[]; transposeSemitones?: unknown };
      items = o.items;
      if (typeof o.transposeSemitones === 'number' && Number.isFinite(o.transposeSemitones)) {
        transposeSemitones = Math.round(o.transposeSemitones);
      }
    } else {
      res.status(400).json({
        error:
          '본문은 항목 배열이거나 { "items": [...], "transposeSemitones"?: number } 형식이어야 합니다',
      });
      return;
    }

    const reviewSavePath =
      job.pipelineMode === 'font_separator'
        ? path.join(job.sessionRoot, 'ocr_data_pymupdf.json')
        : path.join(job.sessionRoot, 'ocr_data.json');
    await fs.writeFile(reviewSavePath, JSON.stringify(items, null, 2), 'utf8');
    await mergeOcrMetaTranspose(job.sessionRoot, transposeSemitones);

    if (
      body &&
      typeof body === 'object' &&
      Array.isArray((body as { partLabelsPreset?: unknown }).partLabelsPreset)
    ) {
      const preset = (body as { partLabelsPreset: unknown[] }).partLabelsPreset.map((x) =>
        String(x ?? '').trim(),
      );
      if (preset.length > 0 && preset.every((l) => l.length > 0)) {
        await fs.writeFile(
          sessionPartLabelsPresetPath(job.sessionRoot),
          JSON.stringify({ version: 1, labelsByIndex: preset }, null, 2),
          'utf8',
        );
      }
    }

    job.reviewDeferred.resolve();
    delete job.reviewDeferred;
    delete job.reviewData;

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

if (fsSync.existsSync(distDir)) {
  const serveStatic = express.static(distDir);
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      next();
      return;
    }
    serveStatic(req, res, next);
  });
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    if (req.path.startsWith('/api')) {
      next();
      return;
    }
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

const host = process.env.LISTEN_HOST || '0.0.0.0';
const server = app.listen(PORT, host, () => {
  const ui = fsSync.existsSync(distDir) ? ' + UI' : '';
  // eslint-disable-next-line no-console
  console.log(`pdf2mxl listening on http://${host}:${PORT} (API${ui})`);
  purgeExpiredJobs();
  setInterval(purgeExpiredJobs, PURGE_INTERVAL_MS);
});
server.setTimeout(30 * 60 * 1000); // 30 minutes timeout for long OCR/Audiveris tasks
