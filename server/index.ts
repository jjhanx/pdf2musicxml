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
process.env.PYTHONUTF8 = '1';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execCallback);

/** fix_audiveris_mxl ??Î¶¨Îì¨ duration Î≥ÄÍ≤ΩÏ? Í∏∞Î≥∏ off(OMR ?†Ï?). */
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
import {
  planHitlResultPropagation,
  shouldRestoreOmrScoreFromRaw,
} from '../shared/omrHitlScoreSync.js';

const PORT = Number(process.env.PORT || 8787);

/** ?ÑÎ£å¬∑?§Ìå® Ï≤òÎ¶¨ ?úÏ†êÎ∂Ä?????úÍ∞Ñ??ÏßÄ?òÎ©¥ ?ëÏóÖ ?àÏΩî?úÏ?(?ÑÏöî ?? ?ÑÏãú ?åÏùº????†ú?©Îãà?? */
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
    ' (?êÎäî pip install pikepdf pdfplumber). Linux?êÏÑú pikepdf ÎπåÎìú ?§Ìå® ??libqpdf-dev ??QPDF Í∞úÎ∞ú ?®ÌÇ§ÏßÄÍ∞Ä ?ÑÏöî?????àÏäµ?àÎã§.';
}

/** font_separator ?åÏù¥?ÑÎùº?∏Ïö© pdfplumber¬∑pikepdf import Í∞Ä???¨Î? */
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
    error: '?∞Ìä∏ Î∂ÑÎ¶¨ ?åÏù¥?ÑÎùº??Python ?®ÌÇ§ÏßÄÍ∞Ä ?§Ïπò?òÏñ¥ ?àÏ? ?äÏäµ?àÎã§',
    detail: `?ÑÎùΩ Î™®Îìà: ${depCheck.missing.join(', ')}. Python: ${depCheck.pythonBin}. ?§Ïπò: ${fontSeparatorDepsInstallHint(depCheck.pythonBin)}`,
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
      'Î≥Ä???ÑÎ£å ?êÎäî ?§Ìå® Ï≤òÎ¶¨ ???úÎ≤Ñ??Î≥¥Í??òÎäî ?ëÏóÖ¬∑?åÏùº?Ä 24?úÍ∞Ñ??ÏßÄ?òÎ©¥ ?êÎèô?ºÎ°ú ??†ú?©Îãà?? ?ÑÎ£å ÏßÅÌõÑ ?§Ïö¥Î°úÎìúÎ•?Î∞õÏïÑ??Í∞ôÏ? jobIdÎ°?ÎßàÏä§?π¬∑Ïù∏???êÍ? API??TTL ?ÑÍπåÏßÄ ?¨Ïö©?????àÏäµ?àÎã§.',
  });
});

/** Audiveris Í≥µÏãù ?úÌä∏ ?®Í≥Ñ ?¥Î¶Ñ Î™©Î°ù (?®Í≥ÑÎ≥??îÎ≤ÑÍπ?UI¬∑?ÑÍµ¨??. */
app.get('/api/audiveris-sheet-steps', (_req, res) => {
  res.json({ steps: [...AUDIVERIS_SHEET_STEPS] });
});

type JobStatus =
  | 'pending'
  | 'processing'
  | 'font_strip_needed'
  | 'deskew_needed'
  | 'deskew_save_needed'
  | 'clean_score_preview_needed'
  | 'lyric_manifest_save_needed'
  | 'review_needed'
  | 'part_labels_needed'
  | 'omr_staff_review_needed'
  | 'audiveris_review_needed'
  | 'completed'
  | 'failed';

type JobProgressPhase = 'upload' | 'separator' | 'audiveris' | 'hitl';

type PipelineMode = 'audiveris_only' | 'pymupdf_review' | 'font_separator' | 'image_pdf' | 'auto';

/** Í∞ôÏ? PDF Î∞òÎ≥µ ?ëÏóÖ ??Ï§ëÍ∞Ñ ?®Í≥ÑÎ∂Ä???úÏûë */
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
      /** ?îÎ≤ÑÍ∑?ZIP???ÖÎ°ú???êÎ≥∏ PDFÎ•??¨Ìï®????*/
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
  /** ?ÖÎ°ú?úÍ? ?ùÎÇòÎ©??§Ï†ï?òÎ©∞, Í∑???executeJob???§Ìñâ?©Îãà?? */
  inputPdfPath?: string;
  isDebug: boolean;
  createdAt: number;
  /** Î≥Ä?òÏù¥ ?ùÎÇú ?úÏ†ê(?±Í≥µ ?êÎäî ÏµúÏ¢Ö ?§Ìå® ?êÏ†ï). TTL Í∏∞Ï?. */
  finishedAt?: number;
  error?: JobErrorPayload;
  result?: JobResult;
  /** UI¬∑?¥ÎßÅ??ÏßÑÌñâÎ•?(?ÖÎ°ú?? Audiveris ?®Í≥Ñ) */
  progress?: JobProgress;
  /** Audiveris Î°úÍ∑∏?êÏÑú Ï∂îÏ∂ú???ÑÏ≤¥ ?òÏù¥ÏßÄ/?????åÌä∏ */
  pdfPageCount?: number;
  reviewDeferred?: { resolve: () => void; reject: (err: Error) => void };
  reviewData?: any;
  /** font_separator: OMR¬∑HITL ?¥ÌõÑ Í∞Ä??Í≤ÄÏ¶?UI (?êÎ≥∏ PDF ÎØ∏Î¶¨Î≥¥Í∏∞) */
  reviewAfterOmr?: boolean;
  /** OMR¬∑HITL ??Í∞Ä??Í≤ÄÏ¶???manifest¬∑1?®Í≥Ñ ?∏Ïßë ?†Ï?(Ï¥àÍ∏∞ Ï∂îÏ∂úÎ°???? ?äÏùå) */
  reviewPreservesEdits?: boolean;
  /** omr-work.zip?êÏÑú Í∞Ä?∏Ïò® Í∞Ä??Í≤ÄÏ¶?JSON???∏ÏÖò???àÏùå */
  hasSavedLyricReview?: boolean;
  /** Audiveris ÏßÅÌõÑ Î≥¥Ï†ï ?®Í≥Ñ??*/
  pauseAfterAudiveris?: boolean;
  preInjectMxlPaths?: string[];
  audiverisReviewDeferred?: { resolve: () => void; reject: (err: Error) => void };
  injectMxlPathsOverride?: string[];
  /** Î≥Ä???åÏù¥?ÑÎùº?? ?∞Ìä∏ Î∂ÑÎ¶¨(Í∂åÏû•) ¬∑ PyMuPDF ÎßàÏä§??¬∑ AudiverisÎß?*/
  pipelineMode?: PipelineMode;
    imagePdfOmrEngine?: string;
  skipPaddleOcr?: boolean;
  /** font_separator Î™®Îìú?êÏÑú PyMuPDF Í∞Ä??Í≤ÄÏ¶?UI ?¨Ïö© */
  enablePymupdfReview?: boolean;
  /** Audiveris ÏßÅÌõÑ ?òÏù¥ÏßÄ√óstaff MXL lint HITL (Í∏∞Î≥∏ ÏºúÏßê) */
  enableOmrStaffReview?: boolean;
  /** full=?êÎ≥∏ PDF, clean_score=clean_score+Í∞Ä?? omr_hitl=ZIP+Í∞Ä?? lyric_inject=ZIP(MXL)+Í∞Ä??JSON */
  startStage?: StartStage;
  resumeCleanScorePath?: string;
  resumeLyricManifestPath?: string;
  resumeOmrWorkZipPath?: string;
  resumeCorrectedMxlPath?: string;
  omrStaffReviewDeferred?: { resolve: () => void; reject: (err: Error) => void };
  partLabelsDeferred?: { resolve: () => void; reject: (err: Error) => void };
  /** ?±Î? ?ºÎ≤® ?ïÏ†ï ÏßÅÌõÑ Î©îÎ™®Î¶?Î≥¥Í?(?åÏùº ?ΩÍ∏∞ ?§Ìå® ??lint relabel?? */
  partLabelsByIndex?: string[];
  fontStripDeferred?: { resolve: () => void; reject: (err: Error) => void };
  fontStripStats?: Record<string, unknown>;
  deskewDeferred?: { resolve: () => void; reject: (err: Error) => void };
  deskewSaveDeferred?: { resolve: () => void; reject: (err: Error) => void };
  deskewAnglesPath?: string;
  cleanScorePreviewDeferred?: { resolve: () => void; reject: (err: Error) => void };
  cleanScorePreviewAction?: 'continue' | 'redo_font_strip';
  lyricManifestSaveDeferred?: { resolve: () => void; reject: (err: Error) => void };
  /** ?¨Ïö©???ÖÎ°ú???êÎ≥∏ PDF ?úÏãú ?¥Î¶Ñ(MXL¬∑ZIP ?§Ïö¥Î°úÎìú Í∏∞Î≥∏Í∞? */
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
    if (job.status === 'completed' || job.status === 'failed') {
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
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
      items?: unknown[];
      pymupdfReviewItems?: unknown[];
    };
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

/** HITL ?∏ÏÖò `review.mxl` ??export¬∑?¨Í∞ú¬∑ÎØ∏Î¶¨Î≥¥Í∏∞ canonical Î≥µÏÇ¨Î≥?*/
function sessionReviewMxlPath(sessionRoot: string): string {
  return path.join(sessionRoot, 'review.mxl');
}

async function mirrorSessionReviewMxl(sessionRoot: string, scorePath: string): Promise<void> {
  if (!fsSync.existsSync(scorePath)) return;
  const reviewPath = sessionReviewMxlPath(sessionRoot);
  if (path.resolve(scorePath) === path.resolve(reviewPath)) return;
  await fs.copyFile(scorePath, reviewPath);
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

type OmrHitlCheckpoint = {
  version?: number;
  rebuiltAt?: string;
  syncMode?: string;
  hitlApplied?: number;
  hitlSkipped?: number;
  pendingCleared?: number;
  totalHitlApplied?: number;
  /** baseline???¨Ïö©??ÍµêÏ†ï(HITL Î≥¥Ï†ï¬∑?êÎèô ?ïÎ¶¨¬∑?òÎèô ?∏ÏßëÎ≥????¥Í≤® ?àÏùå ??raw Î°§Î∞± Í∏àÏ? */
  baselineOwnsEdits?: boolean;
};

async function readOmrHitlCheckpoint(sessionRoot: string): Promise<OmrHitlCheckpoint> {
  try {
    return JSON.parse(
      await fs.readFile(sessionOmrHitlCheckpointPath(sessionRoot), 'utf8'),
    ) as OmrHitlCheckpoint;
  } catch {
    return {};
  }
}

async function writeOmrHitlCheckpoint(
  sessionRoot: string,
  patch: OmrHitlCheckpoint,
): Promise<void> {
  const prior = await readOmrHitlCheckpoint(sessionRoot);
  const next: OmrHitlCheckpoint = {
    ...prior,
    ...patch,
    version: 2,
    rebuiltAt: new Date().toISOString(),
    baselineOwnsEdits: Boolean(prior.baselineOwnsEdits || patch.baselineOwnsEdits),
  };
  await fs.writeFile(
    sessionOmrHitlCheckpointPath(sessionRoot),
    JSON.stringify(next, null, 2),
    'utf8',
  );
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
  // ?êÎèô ?ïÎ¶¨ Í≤∞Í≥º¬∑?åÏßÑ??Î≥¥Ï†ï?Ä baseline?êÎßå ?®Îäî?????§Ïùå ?ôÍ∏∞?îÍ? rawÎ°??òÎèåÎ¶¨Ï? ?äÎèÑÎ°?Í∏∞Î°ù
  const prior = await readOmrHitlCheckpoint(sessionRoot);
  await writeOmrHitlCheckpoint(sessionRoot, {
    syncMode: 'auto-normalize',
    hitlApplied,
    hitlSkipped,
    pendingCleared,
    totalHitlApplied: (prior.totalHitlApplied ?? 0) + hitlApplied,
    baselineOwnsEdits: true,
  });
  await mirrorSessionReviewMxl(sessionRoot, scorePath);
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

/** HITL¬∑Í≤Ä?†Ïö© MXL???∏ÏÖò `audiveris_raw.mxl`Í≥??ôÏùº?òÍ≤å ÎßûÏ∂§(?ÑÏ≤òÎ¶?∑baseline ?§Ïóº ?úÍ±∞). */
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

  const priorCheckpoint = await readOmrHitlCheckpoint(sessionRoot);
  const totalHitlApplied = priorCheckpoint.totalHitlApplied ?? 0;
  const baselineOwnsEdits = priorCheckpoint.baselineOwnsEdits === true;

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
    if (
      shouldRestoreOmrScoreFromRaw({
        totalHitlApplied,
        baselineOwnsEdits,
        pendingFixCount: fixes.length,
        hasRawBackup: fsSync.existsSync(rawPath),
      })
    ) {
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

  await mirrorSessionReviewMxl(sessionRoot, scorePath);

  await writeOmrHitlCheckpoint(sessionRoot, {
    syncMode,
    hitlApplied,
    hitlSkipped,
    pendingCleared,
    totalHitlApplied:
      syncMode === 'restore-from-raw' ? 0 : totalHitlApplied + hitlApplied,
    baselineOwnsEdits: baselineOwnsEdits || hitlApplied > 0,
  });
  return {
    ...postStats,
    hitlApplied,
    hitlSkipped,
    pendingCleared,
    syncMode,
    chordBeamMeasuresCleaned: Math.max(postStats.chordBeamMeasuresCleaned, chordBeamCleaned),
  };
}

/** @deprecated alias ??syncOmrReviewMxl ?¨Ïö© */
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

/** Î¨∏Ïûê Í≤Ä??Ï¥àÏïàÎß??àÏùÑ ??MXL¬∑lintÍ∞Ä preset???∞ÎèÑÎ°?part_labels.json?ºÎ°ú Î≥µÏÇ¨ */
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
  console.log(`part_labels: preset ??part_labels.json (${labels.join(', ')})`);
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

/** ?ÑÎ£å¬∑Î≥¥Ï†ï ?ÄÍ∏∞¬∑Ïã§???ëÏóÖÎß????∏ÏÖò ?¥Îçî??PDFÍ∞Ä ?®ÏïÑ ?®Í≥Ñ ?îÎ≤ÑÍπÖÏùÑ ?åÎ¶¥ ???àÎäî Í≤ΩÏö∞ */
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
  /* Î¶¨ÌÑ∞??/ ??/ ?àÏóê??`/` ?¥Ïä§ÏºÄ?¥ÌîÑÍ∞Ä esbuild?êÏÑú Íπ®Ï?ÎØÄÎ°?Î¨∏Ïûê ?¥Îûò?§Îßå ?¨Ïö© */
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
    throw new Error(`mxl_quality_lint.py ?ÜÏùå: ${script}`);
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
      tail ? `${e.message ?? 'mxl_quality_lint ?§Ìå®'}\n${tail.slice(-1200)}` : (e.message ?? String(err)),
    );
  }
  if (!fsSync.existsSync(outJson)) {
    throw new Error('mxl_lint.json???ùÏÑ±?òÏ? ?äÏïò?µÎãà??);
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

/**
 * HITL ?∏Ïßë¬∑ZIP Î∂àÎü¨?§Í∏∞???∏ÏÖò canonical ?åÏùº(`review.mxl`)?êÎßå ?ÑÏ†Å?úÎã§.
 * Í≤Ä?†Î? ?ùÎÇº ???ÄÍ∏?Ï§?Î≥¥Ï†ï??canonical???åÏßÑ????Í∑?Í≤∞Í≥ºÎ•?Ï£ºÏûÖ¬∑Ï∂úÎ†• ?Ä??MXLÎ°??òÎèå???®ÏÑú,
 * Í∞Ä??Î≥ëÌï©¬∑ÏµúÏ¢Ö ?§Ïö¥Î°úÎìúÍ∞Ä ??ÉÅ ÎßàÏ?Îß?ÍµêÏ†ïÎ≥∏ÏùÑ ?∞ÎèÑÎ°?ÎßûÏ∂ò??
 */
async function applyOmrHitlFixesForJob(job: JobRecord, pythonBin: string): Promise<void> {
  const paths = job.preInjectMxlPaths?.filter((p) => p && fsSync.existsSync(p)) ?? [];
  const reviewPath = sessionReviewMxlPath(job.sessionRoot);
  const canonical = fsSync.existsSync(reviewPath) ? reviewPath : null;
  if (canonical) {
    await syncOmrReviewMxl(job.sessionRoot, canonical, pythonBin);
  }
  const steps = planHitlResultPropagation({
    injectTargets: paths,
    canonicalReviewPath: canonical,
    samePath: (a, b) => path.resolve(a) === path.resolve(b),
  });
  for (const step of steps) {
    if (step.kind === 'copy-canonical') {
      await fs.copyFile(step.from, step.to);
      console.log(`[omr-hitl] ÏµúÏ¢Ö ÍµêÏ†ïÎ≥?review.mxl) ??Ï£ºÏûÖ ?Ä??Î∞òÏòÅ: ${step.to}`);
      continue;
    }
    await applyOmrHitlFixesToScoreFile(job.sessionRoot, step.target, pythonBin);
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
  const restructureScript = path.join(__dirname, '..', 'scripts', 'restructure_mxl_parts.py');
  if (fsSync.existsSync(restructureScript)) {
    try {
      await exec(
        `"${pythonBin}" "${restructureScript}" "${scorePath}" "${scorePath}" "${labelsPath}"`,
        { maxBuffer: 16 * 1024 * 1024 },
      );
      console.log(`restructure_mxl_parts completed for ${scorePath}`);
    } catch (err) {
      console.warn(`restructure_mxl_parts failed (${scorePath}): ${err}`);
    }
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
  // lyric review ?®Í≥Ñ?êÏÑú??(OMR Í≤∞Í≥º) MXL???àÏùÑ ???àÎã§: review.mxl / baseline / raw ?úÏúºÎ°??¨Ïö©
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
    if (job.status === 'omr_staff_review_needed') {
      const review = sessionReviewMxlPath(job.sessionRoot);
      if (fsSync.existsSync(review)) return review;
    }
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

/** omr-work.zip???¨Ìï®??Í∞Ä??Í≤ÄÏ¶??∏Ïßë(?¥Ïñ¥?òÍ∏∞?? */
function sessionOcrPymupdfSavedPath(sessionRoot: string): string {
  return path.join(sessionRoot, 'ocr_data_pymupdf_saved.json');
}

/** ?êÎ≥∏ PDF 1Ï∞?Ï∂îÏ∂ú Í∏∞Ï?(?úÎ™©¬∑?ëÍ≥°¬∑Í∞Ä???ÑÏ≤¥) */
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

/** Í≤Ä??UI Íµ¨Î∂Ñ Í∏∞Î≥∏Í∞???unknown(ÎØ∏Î∂ÑÎ•?ÎØ∏ÏÑ†???Ä Í∞Ä?? ?¨Ïö©?êÍ? Í≥†Î•∏ ÎØ∏Î∂ÑÎ•òÎßå ?†Ï? */
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

/** manifest¬∑1?®Í≥Ñ ?∏ÏßëÎ∂?????ï†¬∑?±Î?¬∑bbox¬∑?òÎèô ?ÅÏó≠ ?†Ï? */
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
  
  const deskewedSrc = pick('deskewed.pdf');
  if (deskewedSrc) {
    const deskewedDest = path.join(sessionRoot, 'deskewed.pdf');
    await fs.copyFile(deskewedSrc, deskewedDest);
  }

  if (deskewedSrc) {
    const deskewedDest = path.join(sessionRoot, 'deskewed.pdf');
    if (job) job.inputPdfPath = deskewedDest;
    hasInput = true;
    if (inputSrc) { // Still restore input.pdf as original for reference
      const inputDest = path.join(sessionRoot, 'input.pdf');
      await fs.copyFile(inputSrc, inputDest);
    }
  } else if (inputSrc) {
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
  /** Í∞Ä??∑PDF???∏ÏÖò ?∞Ï∂úÎ¨??†Ï?, MXL¬∑HITL Î≥¥Ï†ïÎß?ZIP?êÏÑú Í∞Ä?∏Ïò¥ (1?®Í≥Ñ + Í∏∞Ï°¥ MXL) */
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
  if (reviewSrc) {
    await fs.copyFile(reviewSrc, sessionReviewMxlPath(sessionRoot));
  }
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
  // ZIP??baseline??raw?Ä ?§Î•¥Î©??¨Ïö©??ÍµêÏ†ï???¥Í∏¥ Í≤???raw Î°§Î∞± Í∏àÏ?(Íµ¨Î≤Ñ??ZIP?Ä ?åÎûòÍ∑∏Í? ?ÜÎã§)
  if (baselineSrc && rawSrc) {
    try {
      const [baseBuf, rawBuf] = await Promise.all([fs.readFile(baselineSrc), fs.readFile(rawSrc)]);
      if (!baseBuf.equals(rawBuf)) {
        await writeOmrHitlCheckpoint(sessionRoot, { baselineOwnsEdits: true });
      }
    } catch {
      /* ÎπÑÍµê ?§Ìå® ??Í∏∞Ï°¥ checkpoint ?†Ï? */
    }
  }
  if (baselineSrc) {
    await fs.copyFile(baselineSrc, scorePath);
  } else if (reviewSrc) {
    await fs.copyFile(reviewSrc, scorePath);
  } else if (rawSrc) {
    await fs.copyFile(rawSrc, scorePath);
  } else {
    throw new Error('ZIP??review.mxl ?êÎäî audiveris_raw.mxl???ÜÏäµ?àÎã§');
  }
  let manualEditDetected = false;
  if (reviewSrc) {
    if (!baselineSrc) {
      manualEditDetected = true;
    } else {
      try {
        const [baseBuf, reviewBuf] = await Promise.all([
          fs.readFile(baselineSrc),
          fs.readFile(reviewSrc),
        ]);
        if (!baseBuf.equals(reviewBuf)) {
          manualEditDetected = true;
        }
      } catch {}
    }
  }

  /** ZIP??review.mxl???∏Î??êÏÑú ?òÎèô?ºÎ°ú Î≥ÄÍ≤ΩÎêò?àÏùÑ Í≤ΩÏö∞(?êÎäî baseline???ÜÏùÑ Í≤ΩÏö∞), ?¥Î? ?àÎ°ú??baseline?ºÎ°ú ?ºÏïÑ ?òÎèô ?∏Ïßë ?¥Ïö©??Î≥¥Ï°¥?©Îãà?? */
  if (manualEditDetected && reviewSrc) {
    console.warn(
      '[omr-work import] review.mxl ?òÎèô ?∏Ïßë Í∞êÏ? (?êÎäî baseline ?ÑÎùΩ) ???∏Î? ?òÎèô ?∏ÏßëÎ≥∏ÏùÑ ?∞ÏÑ†?òÏó¨ baseline??Í∞±Ïã†?©Îãà??,
    );
    // ?∏Î? ?ÑÎ°úÍ∑∏Îû® ?±ÏúºÎ°??òÏûë???∏Ïßë??review.mxl??Ï°¥Ïû¨?òÎ?Î°? ?¥Î? scorePath?Ä baseline?ºÎ°ú ??ñ¥?åÏõÅ?àÎã§.
    await fs.copyFile(reviewSrc, scorePath);
    await fs.copyFile(reviewSrc, sessionHitlBaselineMxlPath(sessionRoot));

    // syncOmrReviewMxl ?®Í≥Ñ?êÏÑú ?òÎèô ?∏ÏßëÎ≥∏Ïù¥ raw_audiveris ?åÏùºÎ°?Î°§Î∞±?òÎäî Í≤ÉÏùÑ Î∞©Ï??òÍ∏∞ ?ÑÌï¥ checkpoint Ï°∞Ïûë
    const cp = await readOmrHitlCheckpoint(sessionRoot);
    await writeOmrHitlCheckpoint(sessionRoot, {
      syncMode: 'manual-edit-import',
      totalHitlApplied: Math.max(cp.totalHitlApplied ?? 0, 1),
      baselineOwnsEdits: true,
    });

    // ?òÎèô ?∏Ïßë??review.mxl??baseline?ºÎ°ú ?ºÏïò?ºÎ?Î°? Í∏∞Ï°¥ fixesÍ∞Ä Ï§ëÎ≥µ ?ÅÏö©?òÏ? ?äÎèÑÎ°?Ï¥àÍ∏∞?îÌï©?àÎã§.
    await writeOmrHitlFixes(sessionRoot, []);
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
    detail: 'OMR Í≤Ä??ZIP ?ïÏ∂ï ?¥Ï†ú Ï§ë‚Ä?,
  });
  const extractDir = path.join(job.sessionRoot, `_omr_work_import_${Date.now()}`);
  await extractZipArchive(zipPath, extractDir, pythonBin);
  setJobProgress(job, {
    phase: 'hitl',
    current: 1,
    total: 3,
    detail: '?Ä?•Îêú MXL¬∑Î≥¥Ï†ï Î™©Î°ù Î≥µÏõê Ï§ë‚Ä?,
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
    detail: `OMR Í≤Ä??ZIP Î∂àÎü¨?§Í∏∞ ?ÑÎ£å (Î≥¥Ï†ï ${fixCount}Í±?Í∏∞Î°ù)`,
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
        detail: 'Í∞Ä??Í≤ÄÏ¶ùÏö© PDF Ï¥àÍ∏∞ Ï∂îÏ∂ú Ï§ÄÎπ?Ï§ë‚Ä?,
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
  if (!job.resumeOmrWorkZipPath) {
    for (const p of mxlForInject) {
      await restoreScoreFileFromAudiverisRaw(job.sessionRoot, p);
    }
  }
  job.preInjectMxlPaths = [...mxlForInject];
  // early part_labels_needed happens before font_strip_needed now
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
  console.log(`[job ${jobId}] Pausing for OMR staff¬∑page review (HITL)??);
  setJobProgress(job, {
    phase: 'hitl',
    current: 1,
    total: 2,
    detail: 'OMR ?àÏßà Í≤Ä??HITL) ??PDF¬∑MXL ?ÄÏ°∞¬∑Îßà???∏Ïßë ?ÄÍ∏∞‚Ä?,
  });
  job.status = 'omr_staff_review_needed';
  await new Promise<void>((resolve, reject) => {
    job.omrStaffReviewDeferred = { resolve, reject };
  });
  delete job.omrStaffReviewDeferred;
  job.status = 'processing';
  // Í≤Ä??Ï¢ÖÎ£å Í≤ΩÎ°úÍ∞Ä Î¨¥Ïóá?¥Îì† canonical(review.mxl) ÍµêÏ†ïÎ≥∏ÏùÑ Ï£ºÏûÖ ?Ä?ÅÏóê ?ïÏã§??Î∞òÏòÅ
  await applyOmrHitlFixesForJob(job, pythonBin);
  console.log(`[job ${jobId}] OMR staff review done, continuing pipeline??);
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
        error: 'clean_score_only.pdfÍ∞Ä ?ÑÏöî?©Îãà??,
        detail:
          'font_separator Î™®Îìú?êÏÑú Í∞Ä??Í≤ÄÏ¶ù¬∑OMR ?®Í≥ÑÎ∂Ä???úÏûë?òÎ†§Î©??¥Ï†Ñ??ÎßåÎì† clean_score_only.pdfÎ•??®Íªò ?ÖÎ°ú?úÌïò?∏Ïöî.',
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
        error: 'Î∂ÑÎ¶¨??Í∞Ä??lyric_manifest.json)Í∞Ä ?ÑÏöî?©Îãà??,
        detail:
          '2?®Í≥Ñ??clean_score_only.pdf?Ä 1?®Í≥Ñ?êÏÑú ÎßåÎì† lyric_manifest.json(?êÎäî ?ôÎì±??Í∞Ä??JSON)???®Íªò ?ÖÎ°ú?úÌï¥??ÏµúÏ¢Ö MXL??Í∞Ä?¨Î? Ï£ºÏûÖ?????àÏäµ?àÎã§.',
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

/** Í∞Ä??Í≤ÄÏ¶?UI ÎØ∏Î¶¨Î≥¥Í∏∞ ???êÎ≥∏(Í∞Ä???¨Ìï®) PDF ?∞ÏÑ†, clean_score_only??ÏµúÌõÑ */
function resolveLyricReviewPdfPath(job: JobRecord): string | null {
  const candidates: string[] = [];
  if (job.inputPdfPath && fsSync.existsSync(job.inputPdfPath)) {
    candidates.push(job.inputPdfPath);
  }
  const sessionDeskewed = path.join(job.sessionRoot, 'deskewed.pdf');
  const sessionInput = path.join(job.sessionRoot, 'input.pdf');
  const sessionOriginal = path.join(job.sessionRoot, 'original.pdf');
  if (fsSync.existsSync(sessionDeskewed)) candidates.push(sessionDeskewed);
  if (fsSync.existsSync(sessionInput)) candidates.push(sessionInput);
  if (fsSync.existsSync(sessionOriginal)) candidates.push(sessionOriginal);
  const lyricSource = candidates.find((p) => !isCleanScorePdfPath(job, p));
  if (lyricSource) {
    console.log(`[job ${job.id}] resolveLyricReviewPdfPath -> ${lyricSource}`);
    return lyricSource;
  }
  const fallback = candidates[0] ?? null;
  console.log(`[job ${job.id}] resolveLyricReviewPdfPath fallback -> ${fallback}`);
  return fallback;
}

/** ?ÖÎ°ú???êÎ≥∏???∏ÏÖò input.pdfÎ°?Í≥†Ï†ï ??Í∞Ä??Í≤ÄÏ¶ù¬∑ZIP Î≥µÏõê Í≤ΩÎ°ú ?µÏùº */
async function ensureSessionLyricSourcePdf(job: JobRecord): Promise<void> {
  const dest = path.join(job.sessionRoot, 'input.pdf');
  if (fsSync.existsSync(dest)) return;
  const src = resolveLyricReviewPdfPath(job);
  if (!src || isCleanScorePdfPath(job, src)) return;
  await fs.copyFile(src, dest).catch(() => {});
}

/** omr-work.zipÎßåÏúºÎ°??¨Í∞ú????pdfplumber Ï∂îÏ∂ú???ÜÏúºÎ©?Î≥ëÌï© ?§Ìå® Î∞©Ï? */
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
        console.log('[session] extracted_music_text.json ?ùÏÑ± (pdfplumber ?¨Ï∂îÏ∂?');
        return extractedJsonPath;
      }
    } catch (err) {
      console.warn('[session] pdfplumber Ï∂îÏ∂ú ?§Ìå® ??Îπ?extracted ?¨Ïö©', err);
    }
  }
  await fs.writeFile(extractedJsonPath, '[]\n', 'utf8');
  console.warn(
    '[session] extracted_music_text.json ?ÜÏùå ??Îπ?Î∞∞Ïó¥Î°??ÄÏ≤?(omr-work¬∑PyMuPDF Í≤Ä??Î≥ëÌï©)',
  );
  return extractedJsonPath;
}

/** OMR¬∑HITL ??Í∞Ä??Í≤ÄÏ¶ùÏö© ocr_data_pymupdf.json ???ÜÏúºÎ©?manifest¬∑?êÎ≥∏ PDF?êÏÑú Ï§ÄÎπ?*/
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

/** Í≤Ä??UI?????±Î?¬∑?à¬∑Í±¥?àÎõ∞Í∏????¨Îûå???£Ï? Î©îÌ?Îß??úÍ±∞ */
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

/** Í≤Ä??UI PDF Ï¥àÍ∏∞ Ï∂îÏ∂ú ??ÎßàÎîî¬∑?òÏù¥ÏßÄ Î≤àÌò∏Îß??†Ï?, ?òÎ®∏ÏßÄ Í∏∞Î≥∏ ??ï† Í∞Ä??*/
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

/** ?êÎ≥∏ PDF 1Ï∞?Ï∂îÏ∂ú ??PyMuPDF ?ÑÏ≤¥ + pdfplumber Í∞Ä??Î≥¥Í∞ï */
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
  // NOTE: ?¨Ïö©?êÍ? "?êÎ≥∏ ?ºÏù∏ Í∑∏Î?Î°? Í≤ÄÏ¶ùÏùÑ ?êÌï¥ baseline?Ä PyMuPDF 1Ï∞?Ï∂îÏ∂úÎß??¨Ïö©?©Îãà??
  // (pdfplumber Î≥ëÌï©/Î≥¥Í∞ï?Ä lyric_manifest ?ùÏÑ± ?®Í≥Ñ?êÏÑúÎß??¨Ïö©)

  await exec(`"${pythonBin}" "${scriptExtract}" "${pdfPath}" "${tempPymupdf}"`, {
    maxBuffer: 16 * 1024 * 1024,
  });

  const raw = JSON.parse(await fs.readFile(tempPymupdf, 'utf8')) as unknown;
  await fs.unlink(tempPymupdf).catch(() => {});
  if (!Array.isArray(raw)) {
    throw new Error('extract_text.py Ï∂úÎ†•??Î∞∞Ïó¥???ÑÎãô?àÎã§');
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

/** omr-work.zip Î∂àÎü¨??????Í∞Ä??Í≤ÄÏ¶ùÏ? PDF 1Ï∞?Ï∂îÏ∂ú Í∏∞Ï??ºÎ°ú ?úÏûë */
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

/** OMR¬∑HITL ??Í∞Ä??Í≤ÄÏ¶?UI ???∏Ïßë??manifest¬∑pymupdf ?∞ÏÑ†, ?ÜÏúºÎ©?PDF Ï¥àÍ∏∞ Ï∂îÏ∂ú */
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
    throw new Error('ZIP???Ä?•Îêú Í∞Ä??Í≤ÄÏ¶??∞Ïù¥?∞Í? ?ÜÏäµ?àÎã§');
  }
  const raw = JSON.parse(await fs.readFile(savedPath, 'utf8')) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error('?Ä?•Îêú Í∞Ä??Í≤ÄÏ¶?JSON??Î∞∞Ïó¥???ÑÎãô?àÎã§');
  }
  return raw;
}

/** Audiveris¬∑?êÍ? UI???òÍ∏∏ PDF ??clean_score > masked > ?êÎ≥∏ ??*/
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
  const sheet = line.match(/(?:sheet|page|?òÏù¥ÏßÄ)\s*[#:Ôº??\s*(\d+)/i);
  if (sheet && pageFallback > 0) {
    const n = parseInt(sheet[1], 10);
    if (n > 0) return { current: Math.min(n, pageFallback), total: pageFallback };
  }
  return null;
}

function pdftomusicFailureDetail(): string {
  return (
    'PDFtoMusic Pro(p2mp)Í∞Ä MXL???ùÏÑ±?òÏ? Î™ªÌñà?µÎãà?? ' +
    'clean_score_only.pdfÍ∞Ä **Î≤°ÌÑ∞ PDF**(?ÖÎ≥¥ ?∏ÏßëÍ∏∞Ïóê???¥Î≥¥??PDF)?∏Ï?, ' +
    'P2MP_BIN???¨Î∞îÎ•∏Ï? ?ïÏù∏?òÏÑ∏?? ?§Ï∫î/ÎπÑÌä∏Îß?PDF??PDFtoMusic ProÎ°?Ï≤òÎ¶¨?????ÜÏäµ?àÎã§. ' +
    '?îÎ≤ÑÍ∑?ZIP??`omr_engine.log`Î•?Í≤Ä?†Ìïò?∏Ïöî.'
  );
}

function aiOmrFailureDetail(): string {
  const backend = (process.env.AI_OMR_BACKEND || 'homr').trim().toLowerCase();
  if (backend === 'homr') {
    return (
      'homr OMR??MXL???ùÏÑ±?òÏ? Î™ªÌñà?µÎãà?? ?úÎ≤Ñ venv?êÏÑú ' +
      '`pip install -r requirements-ai.txt` ??`homr --init`(?êÎäî `python scripts/run_homr.py --init`)?ºÎ°ú Í∞ÄÏ§ëÏπòÎ•?Î∞õÏïò?îÏ? ?ïÏù∏?òÏÑ∏?? ' +
      '?îÎ≤ÑÍ∑?ZIP??`omr_engine.log`Î•?Í≤Ä?†Ìïò?∏Ïöî.'
    );
  }
  if (backend === 'tromr') {
    return (
      'TrOMR(HuggingFace) OMR ?§Ìå®. `AI_OMR_MODEL`???†Ìö®??Í≥µÍ∞ú Ï≤¥ÌÅ¨?¨Ïù∏?∏Ïù∏ÏßÄ ?ïÏù∏?òÍ±∞??' +
      '`AI_OMR_BACKEND=homr`(Í∏∞Î≥∏)Î°??ÑÌôò?òÏÑ∏?? ?îÎ≤ÑÍ∑?ZIP??`omr_engine.log`Î•?Í≤Ä?†Ìïò?∏Ïöî.'
    );
  }
  return 'AI OMR??MXL???ùÏÑ±?òÏ? Î™ªÌñà?µÎãà?? ?îÎ≤ÑÍ∑?ZIP??`omr_engine.log`Î•?Í≤Ä?†Ìïò?∏Ïöî.';
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

async function detectScoreTitleFromPdf(
  pythonBin: string,
  scriptSeparator: string,
  pdfPath: string,
): Promise<ScoreTitleDto | null> {
  if (!fsSync.existsSync(pdfPath)) return null;
  try {
    const { stdout } = await exec(
      `"${pythonBin}" "${scriptSeparator}" detect-title-pdf "${pdfPath}"`,
      { maxBuffer: 4 * 1024 * 1024 },
    );
    const data = JSON.parse(String(stdout).trim()) as ScoreTitleDto;
    if (!data?.text?.trim() || !Array.isArray(data.bbox) || data.bbox.length < 4) return null;
    return data;
  } catch {
    return null;
  }
}

async function resolveScoreTitleBbox(
  sessionRoot: string,
  cleanPdfPath: string,
  pythonBin: string,
  scriptSeparator: string,
  extractedJsonPath: string,
  prevBbox?: [number, number, number, number],
  bodyBbox?: [number, number, number, number],
): Promise<[number, number, number, number] | undefined> {
  if (bodyBbox) return bodyBbox;
  if (prevBbox) return prevBbox;
  const manifestPath = sessionLyricManifestPath(sessionRoot);
  if (fsSync.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
        items?: Array<{ type?: string; text?: string; bbox?: number[]; page?: number }>;
        pymupdfReviewItems?: Array<{ type?: string; text?: string; bbox?: number[]; page?: number }>;
      };
      for (const coll of [manifest.items, manifest.pymupdfReviewItems]) {
        if (!Array.isArray(coll)) continue;
        for (const item of coll) {
          const text = String(item.text ?? '').trim();
          if (!text || !Array.isArray(item.bbox) || item.bbox.length < 4) continue;
          if (/[\uac00-\ud7a3]/.test(text) && item.bbox[1] < 200) {
            return [item.bbox[0], item.bbox[1], item.bbox[2], item.bbox[3]];
          }
        }
      }
    } catch {
      /* optional */
    }
  }
  const fromExtracted = await detectScoreTitleCandidate(pythonBin, scriptSeparator, extractedJsonPath);
  if (fromExtracted?.bbox) return fromExtracted.bbox;
  const fromPdf = await detectScoreTitleFromPdf(pythonBin, scriptSeparator, cleanPdfPath);
  if (fromPdf?.bbox) return fromPdf.bbox;
  return undefined;
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
): Promise<number> {
  if (scoreTitle.mask === false) return 0;
  if (!Array.isArray(scoreTitle.bbox) || scoreTitle.bbox.length < 4) return 0;
  const tmpJson = path.join(sessionRoot, '.score_title_mask.json');
  await fs.writeFile(tmpJson, JSON.stringify(scoreTitle), 'utf8');
  try {
    const { stderr } = await exec(
      `"${pythonBin}" "${scriptSeparator}" mask-title "${cleanPdfPath}" "${tmpJson}"`,
      { maxBuffer: 16 * 1024 * 1024 },
    );
    await invalidateCleanScorePreviewCache(sessionRoot);
    const m = String(stderr ?? '').match(/\[mask-title\] (\d+) glyph redactions/);
    return m ? parseInt(m[1], 10) : 0;
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

/** scoreTitle??font_strip_config ??lyric_manifest ?ëÏ™Ω??ÎßûÏ∂îÍ≥?inject??title ??™©??Í∞±Ïã† */
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
  cleanPdfPath?: string,
): Promise<ScoreTitleDto | null> {
  const cfg = await readFontStripConfig(sessionRoot);
  const existing = cfg.scoreTitle as ScoreTitleDto | undefined;
  if (existing?.text?.trim() && existing.bbox) return existing;
  let cand = await detectScoreTitleCandidate(pythonBin, scriptSeparator, extractedJsonPath);
  if (!cand?.bbox && cleanPdfPath && fsSync.existsSync(cleanPdfPath)) {
    cand = (await detectScoreTitleFromPdf(pythonBin, scriptSeparator, cleanPdfPath)) ?? cand;
  }
  if (!cand) return existing?.text?.trim() ? existing : null;
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

  let pipelineMode: PipelineMode = job.pipelineMode ?? 'font_separator';
  if (pipelineMode === 'auto' && job.inputPdfPath && fsSync.existsSync(job.inputPdfPath)) {
    try {
      const scriptDetect = path.join(__dirname, '..', 'scripts', 'detect_pdf_type.py');
      const { stdout } = await exec(`"${resolvePythonBin()}" "${scriptDetect}" "${job.inputPdfPath}"`);
      const detected = stdout.trim();
      if (detected === 'image_pdf' || detected === 'font_separator') {
        pipelineMode = detected as PipelineMode;
        job.pipelineMode = pipelineMode;
        console.log(`[job ${jobId}] Auto-detected PDF type: ${pipelineMode}`);
      } else {
        pipelineMode = 'font_separator';
      }
    } catch (e) {
      console.warn(`[job ${jobId}] Failed to detect PDF type, defaulting to font_separator. Error:`, e);
      pipelineMode = 'font_separator';
    }
  } else if (pipelineMode === 'auto') {
    pipelineMode = 'font_separator';
  }
  
  const startStageEarly: StartStage = job.startStage ?? 'full';
  const enablePymupdfReview =
    (pipelineMode === 'font_separator' || pipelineMode === 'image_pdf')
      ? startStageEarly === 'lyric_inject' || job.enablePymupdfReview !== false
      : true;
  const { sessionRoot, originalName, isDebug } = job;
  let inputPdfPath = job.inputPdfPath;
  await ensureSessionLyricSourcePdf(job);
  const outBase = path.join(sessionRoot, 'audiveris-out');
  const wipeSession = () => fs.rm(sessionRoot, { recursive: true, force: true }).catch(() => {});

  const fail = async (payload: JobErrorPayload) => {
    // 24?úÍ∞Ñ ??purgeExpiredJobs?êÏÑú ??†ú?òÎèÑÎ°?wipeSession??Ï£ºÏÑù Ï≤òÎ¶¨?òÏó¨ ?îÎ≤ÑÍ∑?ZIP ?§Ïö¥Î°úÎìúÍ∞Ä Í∞Ä?•ÌïòÍ≤???
    // await wipeSession();
    job.status = 'failed';
    job.error = payload;
    job.finishedAt = Date.now();
    delete job.progress;
  };

  if (!inputPdfPath && (job.startStage ?? 'full') !== 'omr_hitl' && (job.startStage ?? 'full') !== 'lyric_inject') {
    await fail({
      status: 400,
      error: '?ÖÎ†• PDFÍ∞Ä ?ÜÏäµ?àÎã§',
      detail: '?êÎ≥∏ PDF ?êÎäî clean_score_only.pdfÎ•??ÖÎ°ú?úÌïò?∏Ïöî.',
    });
    return;
  }

  job.status = 'processing';

  const pythonBin = resolvePythonBin();
  const activeOmrEngine = (job.imagePdfOmrEngine || resolveOmrEngine()) as any;
  if (activeOmrEngine === 'ai') {
    const aiDeps = await probeAiOmrDeps(pythonBin);
    if (!aiDeps.ok) {
      await fail({
        status: 503,
        error: 'AI OMR Python ?òÏ°¥?±Ïù¥ ?ÜÏäµ?àÎã§',
        detail: aiDeps.hint || `?ÑÎùΩ: ${aiDeps.missing.join(', ')}`,
      });
      return;
    }
  } else if (activeOmrEngine === 'pdftomusic') {
    const p2mDeps = await probePdfToMusicDeps();
    if (!p2mDeps.ok) {
      await fail({
        status: 503,
        error: 'PDFtoMusic Pro(p2mp)Í∞Ä Ï§ÄÎπÑÎêòÏßÄ ?äÏïò?µÎãà??,
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
    let importedMxlFromZip = false;

    if (startStage === 'omr_hitl') {
      if (!job.resumeOmrWorkZipPath || !fsSync.existsSync(job.resumeOmrWorkZipPath)) {
        await fail({
          status: 400,
          error: 'OMR Í≤Ä???ëÏóÖ ZIP???ÑÏöî?©Îãà??,
          detail:
            'OMR ?àÏßà Í≤Ä?†Ïóê???åÏûë???Ä??ZIP)?çÏúºÎ°?Î∞õÏ? omr-work.zip???®Íªò ?ÖÎ°ú?úÌïò?∏Ïöî. Audiveris ?¨Ïù∏???ÜÏù¥ ?Ä?•Îêú MXL¬∑Î≥¥Ï†ï?ºÎ°ú Í≤Ä?†Î? ?¥Ïñ¥Í∞ëÎãà??',
        });
        return;
      }
      setJobProgress(job, {
        phase: 'hitl',
        current: 0,
        total: pageHint,
        detail: '?Ä?•Îêú OMR Í≤Ä??ZIP Î∂àÎü¨?§Îäî Ï§?(Audiveris ?ùÎûµ)??,
      });
      const mxlPath = await bootstrapFromOmrWorkZip(
        job,
        job.resumeOmrWorkZipPath,
        outBase,
        pythonBin,
      );
      outputs = [mxlPath];
      mxlForInject = [mxlPath];
      importedMxlFromZip = true;
      skipAudiverisEngine = true;
      if (job.resumeLyricManifestPath && fsSync.existsSync(job.resumeLyricManifestPath)) {
        await fs.copyFile(job.resumeLyricManifestPath, lyricManifestPath);
      }
      if (!lyricManifestHasItems(lyricManifestPath)) {
        await fail({
          status: 400,
          error: 'ZIP??Î∂ÑÎ¶¨??Í∞Ä?¨Í? ?ÜÏäµ?àÎã§',
          detail:
            '3?®Í≥Ñ omr-work.zip?êÎäî lyric_manifest.json(?êÎäî ocr_data_pymupdf.json)???¨Ìï®?òÏñ¥???©Îãà?? 1?®Í≥Ñ?êÏÑú ?Ä?•Ìïú ZIP???∞Í±∞??Í∞Ä??JSON???®Íªò ?ÖÎ°ú?úÌïò?∏Ïöî.',
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
          error: 'OMR Í≤Ä???ëÏóÖ ZIP???ÑÏöî?©Îãà??,
          detail: '4?®Í≥Ñ??ÍµêÏ†ï ?ÑÎ£å MXL???§Ïñ¥ ?àÎäî omr-work.zip???ÖÎ°ú?úÌïò?∏Ïöî.',
        });
        return;
      }
      if (!job.resumeLyricManifestPath || !fsSync.existsSync(job.resumeLyricManifestPath)) {
        await fail({
          status: 400,
          error: 'Í∞Ä??JSON ?åÏùº???ÑÏöî?©Îãà??,
          detail: '4?®Í≥Ñ???∏Ïßë Ï§ëÏù∏ Í∞Ä??JSON(lyric_manifest.json ?????®Íªò ?ÖÎ°ú?úÌïò?∏Ïöî.',
        });
        return;
      }

      setJobProgress(job, {
        phase: 'hitl',
        current: 0,
        total: pageHint,
        detail: 'ÍµêÏ†ï ?ÑÎ£å MXL¬∑Í∞Ä???∞Ïù¥??Î∂àÎü¨?§Îäî Ï§ë‚Ä?,
      });
      const mxlPath = await bootstrapFromOmrWorkZip(
        job,
        job.resumeOmrWorkZipPath,
        outBase,
        pythonBin,
      );
      outputs = [mxlPath];
      mxlForInject = [mxlPath];
      job.preInjectMxlPaths = [...mxlForInject];
      importedMxlFromZip = true;
      skipAudiverisEngine = true;
      pauseForAudiverisReview = false;

      await fs.copyFile(job.resumeLyricManifestPath, lyricManifestPath);
      await preparePymupdfReviewFromManifest(lyricManifestPath, pymupdfReviewPath);
      await restorePartLabelsFromManifest(job.sessionRoot, lyricManifestPath);

      // omr-work.zip???¨Ìï®??omr_hitl_fixes.json??MXL??ÏµúÏ¢Ö Î∞òÏòÅ?©Îãà??
      await applyOmrHitlFixesForJob(job, pythonBin);
    }

    if (!skipAudiverisEngine) {
    if (pipelineMode === 'audiveris_only') {
      setJobProgress(job, {
        phase: 'upload',
        current: 1,
        total: 1,
        detail: 'Audiveris Ï§ÄÎπ?Ï§?(?†Ìñâ Ï≤òÎ¶¨ ?ÜÏùå)??,
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
          error: '2?®Í≥Ñ??clean_score PDF?Ä Í∞Ä??JSON???ÑÏöî?©Îãà??,
          detail:
            'clean_score_only.pdf?Ä lyric_manifest.json(Î∂ÑÎ¶¨??Í∞Ä?????®Íªò ?ÖÎ°ú?úÌïò?∏Ïöî.',
        });
        return;
      } else {
      
      try {
        console.log(`[job ${jobId}] Detecting part labels from ${inputPdfPath}`);
        const scriptDetectParts = path.join(__dirname, '..', 'scripts', 'detect_parts.py');
        const { stdout: detectOut } = await exec(`"${pythonBin}" "${scriptDetectParts}" "${inputPdfPath}"`);
        const detectedParts = JSON.parse(detectOut.trim());
        if (Array.isArray(detectedParts) && detectedParts.length > 0) {
          const presetPath = sessionPartLabelsPresetPath(sessionRoot);
          await fs.writeFile(
            presetPath,
            JSON.stringify({ version: 1, labelsByIndex: detectedParts }, null, 2),
            'utf8',
          );
          console.log(`[job ${jobId}] Detected and saved part labels preset:`, detectedParts);
        }
      } catch (detectErr) {
        console.warn(`[job ${jobId}] Failed to detect part labels (ignoring):`, detectErr);
      }
      
      console.log(`[job ${jobId}] Pausing for deskew save...`);
      setJobProgress(job, {
        phase: 'hitl',
        current: 0,
        total: 1,
        detail: '?òÌèâ Î≥¥Ï†ï Í≤∞Í≥º ?§Ïö¥Î°úÎìú ?ÄÍ∏?..',
      });
      job.status = 'deskew_save_needed';
      await new Promise<void>((resolve, reject) => {
        job.deskewSaveDeferred = { resolve, reject };
      });
      delete job.deskewSaveDeferred;
      job.status = 'processing';
      console.log(`[job ${jobId}] Deskew save confirmed, continuing...`);

      console.log(`[job ${jobId}] Pausing for early part label setup (?±Î? S/A/T/B????);
      setJobProgress(job, {
        phase: 'hitl',
        current: 0,
        total: 1,
        detail: '?±Î? ?ºÎ≤®(S/A/T/B¬∑PR/PL) Î∞??ÖÎ≥¥ Íµ¨Ï°∞ Ï¥àÍ∏∞ ?ïÏù∏ ?ÄÍ∏∞‚Ä?,
      });
      job.status = 'part_labels_needed';
      await new Promise<void>((resolve, reject) => {
        job.partLabelsDeferred = { resolve, reject };
      });
      delete job.partLabelsDeferred;
      job.status = 'processing';
      console.log(`[job ${jobId}] Early part labels saved, continuing??);

      setJobProgress(job, {
        phase: 'separator',
        current: 0,
        total: 2,
        detail: 'pdfplumberÎ°?Î¨∏Ïûê ?àÏù¥?ÑÏõÉ Ï∂îÏ∂ú Ï§ë‚Ä?,
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
          error: 'extracted_music_text.json ?ùÏÑ± ?§Ìå®',
          detail: 'pdfplumber Ï∂îÏ∂ú Í≤∞Í≥ºÍ∞Ä ?ÜÏäµ?àÎã§.',
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
        console.log(`[job ${jobId}] Pausing for font size strip selection??);
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
          detail: `pikepdf ?çÏä§???úÍ±∞ (${rangeSpec})??,
        });
        console.log(`[job ${jobId}] pdf_separator strip ranges=${rangeSpec}`);
        try {
          const partsJsonPath = path.join(sessionRoot, 'detected_parts_raw.json');
          const partsArg = fsSync.existsSync(partsJsonPath) ? ` --parts-json "${partsJsonPath}"` : '';
          await exec(
            `"${pythonBin}" "${scriptSeparator}" strip "${inputPdfPath}" "${cleanScorePath}" --ranges "${rangeSpec}"${stripPuaFlag}${partsArg}`,
          );
        } catch (stripErr) {
          const msg = stripErr instanceof Error ? stripErr.message : String(stripErr);
          await fail({
            status: 500,
            error: 'clean_score_only.pdf ?ùÏÑ± ?§Ìå®',
            detail: msg,
          });
          return;
        }
        if (!fsSync.existsSync(cleanScorePath)) {
          await fail({
            status: 500,
            error: 'clean_score_only.pdf ?ùÏÑ± ?§Ìå®',
            detail: 'pdf_separator.pyÍ∞Ä ?ÖÎ≥¥ PDFÎ•?ÎßåÎì§ÏßÄ Î™ªÌñà?µÎãà??',
          });
          return;
        }

        const scoreTitleForMask = await ensureAutoScoreTitleInConfig(
          sessionRoot,
          extractedJsonPath,
          pythonBin,
          scriptSeparator,
          cleanScorePath,
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

        console.log(`[job ${jobId}] Pausing for clean_score PDF preview??);
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
          detail: 'PyMuPDFÎ°?Í∞Ä??∑Î©î?Ä Î¨∏Ïûê Ï∂îÏ∂ú Ï§?(Í≤Ä?†Ïö©)??,
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
          detail: 'pdfplumber¬∑PyMuPDF Í≤Ä??Í≤∞Í≥º Î≥ëÌï© Ï§ë‚Ä?,
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

        console.log(`[job ${jobId}] Pausing for lyric_manifest.json save??);
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
    } else if (pipelineMode === 'image_pdf') {
      if (startStage !== 'full') {
        await fail({
          status: 400,
          error: 'Image PDF Î™®Îìú??1?®Í≥Ñ(?êÎ≥∏ PDF)Îß?ÏßÄ?êÌï©?àÎã§',
          detail: '2?®Í≥Ñ ?¥ÌõÑ??ÏßÄ?êÎêòÏßÄ ?äÏäµ?àÎã§.',
        });
        return;
      }
      
      const deskewAnglesPath = path.join(sessionRoot, 'deskew_angles.json');
      const deskewedPdfPath = path.join(sessionRoot, 'deskewed.pdf');
      const scriptDeskewProcessor = path.join(__dirname, '..', 'scripts', 'deskew_processor.py');

      console.log(`[job ${jobId}] Running deskew_processor.py analyze`);
      try {
        await exec(`"${pythonBin}" "${scriptDeskewProcessor}" analyze "${inputPdfPath}" "${deskewAnglesPath}"`, {
          maxBuffer: 16 * 1024 * 1024
        });
      } catch (err) {
        console.warn(`[job ${jobId}] Failed to analyze deskew (ignoring):`, err);
        // Fallback to empty angles
        await fs.writeFile(deskewAnglesPath, '[]', 'utf8');
      }

      console.log(`[job ${jobId}] Pausing for deskew review...`);
      setJobProgress(job, {
        phase: 'hitl',
        current: 0,
        total: 1,
        detail: '?òÌèâ Î≥¥Ï†ï(Deskew) Í∞ÅÎèÑ ?ïÏù∏ ?ÄÍ∏?..',
      });
      job.status = 'deskew_needed';
      job.deskewAnglesPath = deskewAnglesPath;
      await new Promise<void>((resolve, reject) => {
        job.deskewDeferred = { resolve, reject };
      });
      delete job.deskewDeferred;
      job.status = 'processing';
      console.log(`[job ${jobId}] Deskew confirmed, applying...`);

      try {
        await new Promise<void>((resolve, reject) => {
          const { spawn } = require('child_process');
          const proc = spawn(pythonBin, [scriptDeskewProcessor, 'apply', inputPdfPath, deskewAnglesPath, deskewedPdfPath]);
          let errOut = '';
          let outBuf = '';
          proc.stdout.on('data', (d: Buffer) => {
            outBuf += d.toString();
            const lines = outBuf.split('\n');
            outBuf = lines.pop() || '';
            for (const line of lines) {
              const m = line.match(/PROGRESS:\s*(\d+)\/(\d+)/);
              if (m) {
                setJobProgress(job, {
                  phase: 'hitl',
                  current: parseInt(m[1], 10),
                  total: parseInt(m[2], 10),
                  detail: '?òÌèâ Î≥¥Ï†ï Í≤∞Í≥º ?ùÏÑ± Ï§?..',
                });
              }
            }
          });
          proc.stderr.on('data', (d: Buffer) => {
            errOut += d.toString();
          });
          proc.on('close', (code: number) => {
            if (code !== 0) reject(new Error(`deskew apply failed with exit code ${code}: ${errOut}`));
            else resolve();
          });
          proc.on('error', reject);
        });
        
        if (fsSync.existsSync(deskewedPdfPath)) {
          inputPdfPath = deskewedPdfPath; // Use the deskewed PDF for the rest of the pipeline
          job.inputPdfPath = inputPdfPath; // Update job record
          
          // Clear any previously cached PNGs that were based on the original un-deskewed PDF
          try {
            const reviewCache = path.join(sessionRoot, '.review-ui-cache');
            const diagCache = path.join(sessionRoot, '.diag-cache');
            if (fsSync.existsSync(reviewCache)) await fs.rm(reviewCache, { recursive: true, force: true });
            if (fsSync.existsSync(diagCache)) await fs.rm(diagCache, { recursive: true, force: true });
          } catch (e) {
            console.warn(`[job ${jobId}] Failed to clear caches after deskew:`, e);
          }
        }
      } catch (err) {
        console.warn(`[job ${jobId}] Failed to apply deskew (continuing with original):`, err); throw err;
      }
      
      try {
        console.log(`[job ${jobId}] Detecting part labels from ${inputPdfPath}`);
        const scriptDetectParts = path.join(__dirname, '..', 'scripts', 'detect_parts.py');
        const { stdout: detectOut } = await exec(`"${pythonBin}" "${scriptDetectParts}" "${inputPdfPath}"`);
        const detectedParts = JSON.parse(detectOut.trim());
        if (Array.isArray(detectedParts) && detectedParts.length > 0) {
          const presetPath = sessionPartLabelsPresetPath(sessionRoot);
          await fs.writeFile(
            presetPath,
            JSON.stringify({ version: 1, labelsByIndex: detectedParts }, null, 2),
            'utf8',
          );
          console.log(`[job ${jobId}] Detected and saved part labels preset:`, detectedParts);
        }
      } catch (detectErr) {
        console.warn(`[job ${jobId}] Failed to detect part labels (ignoring):`, detectErr);
      }
      
      console.log(`[job ${jobId}] Pausing for deskew save...`);
      setJobProgress(job, {
        phase: 'hitl',
        current: 0,
        total: 1,
        detail: '?òÌèâ Î≥¥Ï†ï Í≤∞Í≥º ?§Ïö¥Î°úÎìú ?ÄÍ∏?..',
      });
      job.status = 'deskew_save_needed';
      await new Promise<void>((resolve, reject) => {
        job.deskewSaveDeferred = { resolve, reject };
      });
      delete job.deskewSaveDeferred;
      job.status = 'processing';
      console.log(`[job ${jobId}] Deskew save confirmed, continuing...`);

      console.log(`[job ${jobId}] Pausing for early part label setup (?±Î? S/A/T/B????);
      setJobProgress(job, {
        phase: 'hitl',
        current: 0,
        total: 1,
        detail: '?±Î? ?ºÎ≤®(S/A/T/B¬∑PR/PL) Î∞??ÖÎ≥¥ Íµ¨Ï°∞ Ï¥àÍ∏∞ ?ïÏù∏ ?ÄÍ∏∞‚Ä?,
      });
      job.status = 'part_labels_needed';
      await new Promise<void>((resolve, reject) => {
        job.partLabelsDeferred = { resolve, reject };
      });
      delete job.partLabelsDeferred;
      job.status = 'processing';
      console.log(`[job ${jobId}] Early part labels saved, continuing??);

      const scriptImageProcessor = path.join(__dirname, '..', 'scripts', 'image_pdf_processor.py');
      
      setJobProgress(job, {
        phase: 'separator',
        current: 0,
        total: 2,
        detail: 'PaddleOCRÎ°??¥Î?ÏßÄ PDF ?çÏä§??Ï∂îÏ∂ú Ï§ë‚Ä?,
      });
      if (job.skipPaddleOcr) {
        console.log(`[job ${jobId}] Skipping PaddleOCR extract, creating empty JSON`);
        // We still need extractedJsonPath for the next step, so we mock it.
        // The mock must match what `image_pdf_processor.py extract` would output:
        // A list of objects { "page": i, "text_elements": [] }
        // We don't know the exact page count here easily unless we read it, 
        // but image_pdf_processor mask uses the page numbers from the JSON.
        // Actually, we can just write an empty array, and the frontend review 
        // logic will just start from scratch, and we can generate page entries during resume.
        // But to be safe, let's write an empty array for now.
        const mockEmpty = [];
        await fs.writeFile(extractedJsonPath, JSON.stringify(mockEmpty, null, 2), 'utf8');
      } else {
        console.log(`[job ${jobId}] Running image_pdf_processor.py extract`);
        try {
          await exec(
            `"${pythonBin}" "${scriptImageProcessor}" extract "${inputPdfPath}" "${extractedJsonPath}"`,
            { maxBuffer: 16 * 1024 * 1024 }
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await fail({ status: 500, error: 'OCR extract error', detail: msg });
          return;
        }
      }

      if (enablePymupdfReview) {
        const extractedStr = await fs.readFile(extractedJsonPath, 'utf8');
        const extracted = JSON.parse(extractedStr);
        const reviewItems: any[] = [];
        for (const pageData of extracted) {
          const pageNum = pageData.page + 1; // 1-indexed for frontend
          for (const item of (pageData.text_elements || [])) {
            const textRaw = (item.raw_text || '').trim();
            if (!textRaw) continue;
            if (textRaw === 'C') continue;
            if (/^[\d\s/]+$/.test(textRaw)) continue; // numbers/time sigs
            const lower = textRaw.toLowerCase();
            const dynamics = new Set(["p", "mp", "mf", "f", "ff", "fff", "sfz", "cresc", "cresc.", "dim", "dim.", "rit", "rit.", "a tempo"]);
            if (dynamics.has(lower)) continue;

            reviewItems.push({
              page: pageNum,
              type: 'text',
              bbox: [item.x0, item.y0, item.x1, item.y1],
              text: item.raw_text,
            });
          }
        }
        await fs.writeFile(pymupdfReviewPath, JSON.stringify(reviewItems, null, 2), 'utf8');

        setJobProgress(job, {
          phase: 'separator',
          current: 1,
          total: 2,
          detail: '?¨Ïö©??Í∞Ä??ÎßàÏä§??Î∞ïÏä§ ?ïÏù∏ Î∞??∏Ïßë ?ÄÍ∏∞Ï§ë',
        });
        
        job.status = 'review_needed';
        job.reviewData = reviewItems;
        console.log(`[job ${jobId}] Paused for PyMuPDF review (image_pdf)`);
        await new Promise<void>((resolve, reject) => {
          job.reviewDeferred = { resolve, reject };
        });
        job.status = 'processing';
        delete job.reviewData;
        console.log(`[job ${jobId}] Resumed after PyMuPDF review (image_pdf)`);

        // Convert back
        const updatedItems = JSON.parse(await fs.readFile(pymupdfReviewPath, 'utf8'));
        const extractedByPage = new Map();
        for (const p of extracted) {
          extractedByPage.set(p.page, p);
          p.text_elements = [];
        }
        for (const item of updatedItems) {
          if (item.type !== 'text') {
            if (item.type === '_manual_lyric_mask') {
              extracted.push(item);
            }
            continue;
          }
          const pageIdx = item.page - 1;
          if (!extractedByPage.has(pageIdx)) {
            const newPageData = { page: pageIdx, text_elements: [] };
            extractedByPage.set(pageIdx, newPageData);
            extracted.push(newPageData);
          }
          extractedByPage.get(pageIdx).text_elements.push({
            raw_text: item.text || '',
            x0: item.bbox[0],
            y0: item.bbox[1],
            x1: item.bbox[2],
            y1: item.bbox[3],
            fontname: 'Manual',
            size: item.bbox[3] - item.bbox[1]
          });
        }
        // sort extracted by page just in case
        extracted.sort((a: any, b: any) => a.page - b.page);
        await fs.writeFile(extractedJsonPath, JSON.stringify(extracted, null, 2), 'utf8');
      }
      
      if (job.false) {
        setJobProgress(job, {
          phase: 'separator',
          current: 1,
          total: 2,
          detail: 'AI OMR ?¨Ïö©?ºÎ°ú ÎßàÏä§??Í±¥ÎÑà?Ä (?êÎ≥∏ Î≥¥Ï°¥)??,
        });
        console.log(`[job ${jobId}] Skipping mask for AI OMR, copying ${inputPdfPath} to ${cleanScorePath}`);
        await fs.copyFile(inputPdfPath, cleanScorePath);
      } else {
        setJobProgress(job, {
          phase: 'separator',
          current: 1,
          total: 2,
          detail: 'Ï∂îÏ∂ú???çÏä§???ÅÏó≠ ÎßàÏä§??Ï§ë‚Ä?,
        });
        console.log(`[job ${jobId}] Running mask_pdf.py for image_pdf`);
        
        if (fsSync.existsSync(extractedJsonPath)) {
          try {
            const scriptMask = path.join(__dirname, '..', 'scripts', 'mask_pdf.py');
            await exec(
              `"${pythonBin}" "${scriptMask}" "${inputPdfPath}" "${cleanScorePath}" "${extractedJsonPath}"`,
              {
                env: {
                  ...process.env,
                  MASK_PDF_LYRIC_SELECTIVE: '0',
                  MASK_PDF_GLOBAL_HANGUL_SYLLABLE_BLANK: '0',
                }
              }
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await fail({ status: 500, error: 'ÎßàÏä§???§Ìå®', detail: msg });
            return;
          }
        } else {
          console.log(`[job ${jobId}] ${extractedJsonPath} not found. Proceeding without masking.`);
          await fs.copyFile(inputPdfPath, cleanScorePath);
        }
      }
      
      setJobProgress(job, {
        phase: 'separator',
        current: 1,
        total: 1,
        detail: 'Í∞Ä??Îß§Îãà?òÏä§??Î≥ëÌï© Ï§ë‚Ä?,
      });
      const mergeArgs = [
        `"${pythonBin}"`,
        `"${scriptMergeLyrics}"`,
        `"${extractedJsonPath}"`,
        `"${lyricManifestPath}"`,
        `--output-flat "${ocrJsonPath}"`,
      ];
      console.log(`[job ${jobId}] Running merge_lyric_sources.py`);
      const { stdout: mOut, stderr: mErr } = await exec(mergeArgs.join(' '));
      if (mOut) console.log(`[job ${jobId}] merge_lyric_sources.py Output:\n${mOut}`);
      if (mErr?.trim()) console.warn(`[job ${jobId}] merge_lyric_sources.py stderr:\n${mErr}`);
      
      await attachPartLabelsToManifest(sessionRoot, lyricManifestPath, job);

      console.log(`[job ${jobId}] Pausing for lyric_manifest.json save??);
      job.status = 'lyric_manifest_save_needed';
      await new Promise<void>((resolve, reject) => {
        job.lyricManifestSaveDeferred = { resolve, reject };
      });
      delete job.lyricManifestSaveDeferred;
      job.status = 'processing';
      console.log(`[job ${jobId}] lyric_manifest save step completed`);

    } else {
      // pymupdf_review ??Í∏∞Ï°¥ ÎßàÏä§???åÏù¥?ÑÎùº??(1?®Í≥Ñ fullÎß?
      if (startStage !== 'full') {
        await fail({
          status: 400,
          error: 'PyMuPDF ÎßàÏä§??Î™®Îìú??1?®Í≥Ñ(?êÎ≥∏ PDF)Îß?ÏßÄ?êÌï©?àÎã§',
          detail: '2?®Í≥Ñ ?¥ÌõÑ???åÌè∞???¨Í∏∞ Î∂ÑÎ¶¨??Î∞©Ïãù???¨Ïö©?òÏÑ∏??',
        });
        return;
      }
      setJobProgress(job, {
        phase: 'upload',
        current: 1,
        total: 1,
        detail: 'PDF?êÏÑú Î¨∏Ïûê Ï∂îÏ∂ú Ï§?(PyMuPDF / RapidOCR)??,
      });

      console.log(`[job ${jobId}] Running extract_text.py using ${pythonBin}`);
      const { stdout, stderr } = await exec(
        `"${pythonBin}" "${scriptExtract}" "${inputPdfPath}" "${ocrJsonPath}"`,
      );
      if (stdout) console.log(`[job ${jobId}] extract_text.py Output:\n${stdout}`);
      if (stderr) console.error(`[job ${jobId}] extract_text.py Error:\n${stderr}`);

      if (fsSync.existsSync(ocrJsonPath)) {
        const ocrData = JSON.parse(await fs.readFile(ocrJsonPath, 'utf8'));
        console.log(`[job ${jobId}] Pausing for UI review??);
        job.status = 'review_needed';
        job.reviewData = ocrData;
        await new Promise<void>((resolve, reject) => {
          job.reviewDeferred = { resolve, reject };
        });
        console.log(`[job ${jobId}] Review completed, resuming??);
        job.status = 'processing';
      }

      setJobProgress(job, {
        phase: 'audiveris',
        current: 0,
        total: pageHint,
        detail: activeOmrEngine === 'ai' ? 'PDF ÎßàÏä§??Î∞?OMR Ï§ÄÎπ?Ï§ë‚Ä? : 'PDF ÎßàÏä§??Î∞?Audiveris Ï§ÄÎπ?Ï§ë‚Ä?,
      });

      if (fsSync.existsSync(ocrJsonPath)) {
        console.log(`[job ${jobId}] Running mask_pdf.py using ${pythonBin}`);
        await exec(
          `"${pythonBin}" "${scriptMask}" "${inputPdfPath}" "${maskedPdfPath}" "${ocrJsonPath}"`,
        );
      }
    }

    if (
      startStage === 'full' &&
      job.resumeOmrWorkZipPath &&
      fsSync.existsSync(job.resumeOmrWorkZipPath)
    ) {
      setJobProgress(job, {
        phase: 'hitl',
        current: 0,
        total: pageHint,
        detail: 'Í∏∞Ï°¥ OMR Í≤Ä??ZIP?êÏÑú MXL Î∂àÎü¨?§Îäî Ï§?(Audiveris ?ùÎûµ)??,
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
        activeOmrEngine === 'pdftomusic'
          ? audiverisInput?.kind === 'clean_score'
            ? 'clean_score_only.pdf ??PDFtoMusic Pro ?∏Ïãù Ï§ë‚Ä?
            : 'PDFtoMusic Pro ?ÖÎ≥¥ ?∏Ïãù Ï§ë‚Ä?
          : activeOmrEngine === 'ai'
            ? audiverisInput?.kind === 'clean_score'
              ? 'clean_score_only.pdf ??Audiveris ?∏Ïãù Ï§ë‚Ä?
              : 'Audiveris ?∏Ïãù Ï§ë‚Ä?
            : audiverisInput?.kind === 'clean_score'
              ? 'clean_score_only.pdf ??Audiveris ?ÖÎ≥¥ ?∏Ïãù Ï§ë‚Ä?
              : 'Audiveris ?ÖÎ≥¥ ?∏Ïãù Ï§ë‚Ä?,
    });

    const p2mpBin = resolveP2mpBin();
    console.log(
      `[job ${jobId}] Running ${activeOmrEngine} OMR on ${pdfToProcess} (pipeline=${pipelineMode})??,
    );

    const result = await runOmrEngine({
      engineOverride: activeOmrEngine,
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
              activeOmrEngine === 'pdftomusic'
                ? 'PDFtoMusic Pro Ï≤òÎ¶¨'
                : activeOmrEngine === 'ai'
                  ? 'Audiveris Ï≤òÎ¶¨'
                  : 'Audiveris Ï≤òÎ¶¨',
          });
        }
      },
    });

    const logOutPath = path.join(job.sessionRoot, 'omr_engine.log');
    const logContent = `==== ${activeOmrEngine} STDOUT ====\n${result.stdout}\n==== ${activeOmrEngine} STDERR ====\n${result.stderr}\n`;
    await fs.writeFile(logOutPath, logContent, 'utf8').catch((err) =>
      console.warn(`[job ${jobId}] Failed to save omr_engine.log:`, err),
    );

    outputs =
      result.mxlPaths.length > 0 ? result.mxlPaths : await collectMusicXmlOutputs(outBase);

    mxlForInject = outputs.filter((p) => p.toLowerCase().endsWith('.mxl'));

    const autoPauseFromAudiverisLog =
      activeOmrEngine === 'audiveris' &&
      audiverisLogSuggestsHumanReview(result.stdout, result.stderr);
    if (autoPauseFromAudiverisLog) {
      console.log(
        `[job ${jobId}] AUDIVERIS_PAUSE_ON_WARN: Î°úÍ∑∏??WARN ?±Ïù¥ Í∞êÏ??òÏñ¥ Audiveris Î≥¥Ï†ï(HITL) ?®Í≥ÑÎ°??ÑÌôò?©Îãà??`,
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
      console.log(`[job ${jobId}] Pausing for Audiveris Í≤∞Í≥º Î≥¥Ï†ï??);
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
      console.log(`[job ${jobId}] Audiveris Î≥¥Ï†ï ?®Í≥Ñ ?¥ÌõÑ Ï£ºÏûÖ ?¨Í∞ú...`);
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
          detail: 'Í∞Ä??Í≤ÄÏ¶ù¬∑Ìé∏Ïß??ÄÍ∏∞‚Ä?,
        });
        console.log(`[job ${jobId}] Pausing for PyMuPDF lyric review (font_separator) AFTER OMR HITL??);
        job.status = 'review_needed';
        job.reviewAfterOmr = true;
        job.reviewData = ocrData;
        await new Promise<void>((resolve, reject) => {
          job.reviewDeferred = { resolve, reject };
        });
        console.log(`[job ${jobId}] PyMuPDF review completed, merging final lyric sources??);
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
            detail: 'pdfplumber¬∑PyMuPDF Í≤Ä??Í≤∞Í≥º Î≥ëÌï© Ï§ë‚Ä?,
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
          ? 'Í∞Ä??Í≤ÄÏ¶??ùÎûµ ???êÎ≥∏ PDF(input.pdf) ?ÜÏùå. omr-work ZIP??input.pdfÎ•??£Í±∞???êÎ≥∏ PDFÎ•??ÖÎ°ú?úÌïò?∏Ïöî.'
          : 'Í∞Ä??Í≤ÄÏ¶??ùÎûµ ??PyMuPDF Ï∂îÏ∂ú ?∞Ïù¥???ÜÏùå(lyric_manifest.json ?êÎäî ?êÎ≥∏ PDF ?ïÏù∏).';
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
        detail: 'ÏµúÏ¢Ö MXL ?ÑÏ≤òÎ¶??ºÌëú¬∑?ºÏïÑ??timeline¬∑Ï°∞Ìëú) Ï§ë‚Ä?,
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
        detail: '?∏Ïãù??Í∞Ä?¨Ï? Î©îÌ??∞Ïù¥??Ï£ºÏûÖ Ï§ë‚Ä?,
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
      let extraDetail = '';
      if (activeOmrEngine === 'audiveris') {
        const logPath = path.join(job.sessionRoot, 'audiveris-out', 'omr_engine.log');
        if (fsSync.existsSync(logPath)) {
          try {
            const logContent = fsSync.readFileSync(logPath, 'utf8');
            const match = logContent.match(/WARN\s+\[.*#(\d+)\]\s+Book\s+\d+\s+\|\s+Error processing stub/);
            if (match) {
              extraDetail = `\n\n?ö® [?êÎèô Î∂ÑÏÑù ?åÎ¶º]: OMR ?îÏßÑ??**${match[1]}?òÏù¥ÏßÄ**Î•?Î∂ÑÏÑù?òÎçò Ï§?Î≥µÏû°???ÖÎ≥¥ Í∏∞Ìò∏(?¥ÏùåÏ§???Î°??∏Ìï¥ ?¥Î? ÏπòÎ™Ö???§Î•ò(Error processing stub)Í∞Ä Î∞úÏÉù?òÏó¨ Ï§ëÎã®?òÏóà?µÎãà?? ???òÏù¥ÏßÄ??Audiveris ?îÏßÑ???úÍ≥ÑÎ°?Ï≤òÎ¶¨Í∞Ä Î∂àÍ??•Ìï©?àÎã§. ?îÎ≤ÑÍ∑?ZIP???§Ïö¥Î°úÎìú???? Audiveris PC ?ÑÎ°úÍ∑∏Îû®?ºÎ°ú .omr ?åÏùº???¥Ïñ¥ ${match[1]}?òÏù¥ÏßÄ??Î¨∏Ï†úÍ∞Ä ?òÎäî Í∏∞Ìò∏Î•???†ú?òÍ±∞???¥Îãπ ?òÏù¥ÏßÄÎ•??úÏô∏?????òÎèô?ºÎ°ú .mxl??Ï∂îÏ∂ú?òÏÑ∏?? Í∑???[4?®Í≥Ñ]Î•??µÌï¥ ?ÖÎ°ú?úÌï¥ Ï£ºÏÑ∏??`;
            }
          } catch (e) {
            console.error('Error reading omr_engine.log:', e);
          }
        }
      }

      await fail({
        status: 422,
        error:
          startStage === 'omr_hitl'
            ? 'OMR Í≤Ä??ZIP?êÏÑú MXL??Î∂àÎü¨?§Ï? Î™ªÌñà?µÎãà??
            : activeOmrEngine === 'pdftomusic'
            ? 'PDFtoMusic ProÍ∞Ä MusicXML/MXL??ÎßåÎì§ÏßÄ Î™ªÌñà?µÎãà??
            : activeOmrEngine === 'ai'
              ? 'AI OMR??MusicXML/MXL??ÎßåÎì§ÏßÄ Î™ªÌñà?µÎãà??
              : 'AudiverisÍ∞Ä MusicXML/MXL??ÎßåÎì§ÏßÄ Î™ªÌñà?µÎãà??,
        detail:
          startStage === 'omr_hitl'
            ? 'ZIP??review.mxl ?êÎäî audiveris_raw.mxl???àÎäîÏßÄ ?ïÏù∏?òÏÑ∏??'
            : activeOmrEngine === 'pdftomusic'
            ? pdftomusicFailureDetail()
            : activeOmrEngine === 'ai'
              ? aiOmrFailureDetail()
              : ('Audiveris Ï∂úÎ†• ?¥Îçî??.mxl/.musicxml???ÜÏäµ?àÎã§. Î°úÍ∑∏??WARN [#N]¬∑ERS ?±Ï? Î≥¥ÌÜµ ?¥Îãπ ??Ï≤òÎ¶¨ ?¥Î≥¥?¥Í∏∞ Î¨∏Ï†úÎ•??ªÌïòÎ©? ???•Ïù¥?ºÎèÑ ?§Ìå®?òÎ©¥ ?åÏùº???ÜÏùÑ ???àÏäµ?àÎã§. Audiveris GUIÎ°??ôÏùº PDFÎ•??¥Ïñ¥ ?§Î•òÎ•??ïÏù∏?òÍ±∞???îÎ≤ÑÍ∑?ZIP??Î°úÍ∑∏Î•?Í≤Ä?†Ìïò?∏Ïöî.' + extraDetail),
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
    await fail({ status: 500, error: 'Î≥Ä??Ï§??§Î•ò', detail: msg });
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
      detail: 'Linux: export AUDIVERIS_BIN=/opt/audiveris/bin/Audiveris  (?àÍ±∞?? OMR_ENGINE=audiveris)',
    });
    return;
  }

  const ct = req.headers['content-type'] || '';
  if (!ct.toLowerCase().includes('multipart/form-data')) {
    res
      .status(400)
      .json({ error: 'Content-Type?Ä multipart/form-data ?¨Ïïº ?©Îãà??(?ÑÎìú pdf, ?†ÌÉù debug)' });
    return;
  }

  let sessionRoot: string;
  try {
    sessionRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), 'pdf2mxl-up-'));
  } catch (_e) {
    res.status(500).json({ error: '?ÑÏãú ?ÖÎ°ú???¥ÎçîÎ•?ÎßåÎì§ ???ÜÏäµ?àÎã§' });
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
  /** 202??multipart¬∑?åÏùº ?Ä?•Ïù¥ ?ùÎÇú ?§ÏóêÎß?Î≥¥ÎÉÖ?àÎã§(Ï°∞Í∏∞ 202 ???ºÎ? Î∏åÎùº?∞Ï?¬∑?ÑÎ°ù?úÏóê??Î≥∏Î¨∏ ?ÑÏÜ°??Î©àÏ∂§). */

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
  let imagePdfOmrEngineField = 'ai';
  let skipPaddleOcrField = true;
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
      if (v === 'audiveris_only' || v === 'pymupdf_review' || v === 'font_separator' || v === 'image_pdf' || v === 'auto') {
        pipelineModeField = v as PipelineMode;
      }
    }
    if (name === 'imagePdfOmrEngine') {
      const v = String(val).trim();
      if (v === 'ai' || v === 'audiveris' || v === 'pdftomusic') {
        imagePdfOmrEngineField = v;
      }
    }
    if (name === 'skipPaddleOcr') {
      skipPaddleOcrField = val === 'true';
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
          error: '?åÏùº???àÎ¨¥ ?ΩÎãà??,
          detail: `ÏµúÎ? ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB`,
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
              error: '?ÖÎ°ú???Ä???§Ìå®',
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
        detail: 'PDF ?åÏùº ?Ä??Ï§ë‚Ä?,
      });
      queueUpload(destPath, (j) => {
        j.inputPdfPath = destPath;
        setJobProgress(j, {
          phase: 'upload',
          current: 1,
          total: 1,
          detail: '?ÖÎ°ú???ÑÎ£å, Î≥Ä??Ï§ÄÎπ?Ï§ë‚Ä?,
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
      error: 'multipart Ï≤òÎ¶¨ ?§Î•ò',
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
            error: 'pdf ?åÏùº ?ÑÎìúÍ∞Ä ?ÑÏöî?©Îãà??,
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
            error: '?ÖÎ°ú?úÍ? ?ÑÎ£å?òÏ? ?äÏïò?µÎãà??,
          });
          return;
        }
      }
      if (startStageField === 'omr_hitl' && !job.resumeOmrWorkZipPath) {
        failReceive({
          status: 400,
          error: 'OMR Í≤Ä???ëÏóÖ ZIP???ÑÏöî?©Îãà??,
          detail: '?úÏûë ?®Í≥ÑÍ∞Ä ?åOMR Í≤Ä???¥Ïñ¥?òÍ∏∞?çÏùº ??omrWorkZip ?åÏùº???®Íªò ?ÖÎ°ú?úÌïò?∏Ïöî.',
        });
        return;
      }
      if (startStageField === 'clean_score') {
        if (!job.resumeCleanScorePath) {
          failReceive({
            status: 400,
            error: 'clean_score_only.pdfÍ∞Ä ?ÑÏöî?©Îãà??,
            detail: '2?®Í≥Ñ??clean_score_only.pdfÎ•??ÖÎ°ú?úÌïò?∏Ïöî.',
          });
          return;
        }
        if (!job.resumeLyricManifestPath) {
          failReceive({
            status: 400,
            error: 'Î∂ÑÎ¶¨??Í∞Ä??JSON???ÑÏöî?©Îãà??,
            detail: '2?®Í≥Ñ??1?®Í≥Ñ?êÏÑú ÎßåÎì† lyric_manifest.json(Í∞Ä?????®Íªò ?ÖÎ°ú?úÌïò?∏Ïöî.',
          });
          return;
        }
      }
      if (startStageField === 'lyric_inject') {
        if (!job.resumeOmrWorkZipPath) {
          failReceive({
            status: 400,
            error: 'OMR Í≤Ä???ëÏóÖ ZIP???ÑÏöî?©Îãà??,
            detail: '4?®Í≥Ñ??omr-work.zip???ÖÎ°ú?úÌïò?∏Ïöî.',
          });
          return;
        }
        if (!job.resumeLyricManifestPath) {
          failReceive({
            status: 400,
            error: 'Í∞Ä??JSON ?åÏùº???ÑÏöî?©Îãà??,
            detail: '4?®Í≥Ñ???∏Ïßë Ï§ëÏù∏ Í∞Ä??JSON???®Íªò ?ÖÎ°ú?úÌïò?∏Ïöî.',
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
          error: 'clean_score_only.pdfÍ∞Ä ?ÑÏöî?©Îãà??,
          detail: '2?®Í≥Ñ??clean_score_only.pdf?Ä lyric_manifest.json???®Íªò ?ÖÎ°ú?úÌïò?∏Ïöî.',
        });
        return;
      }
      if (startStageField === 'lyric_inject') {
        enablePymupdfReviewField = true;
      }
      job.isDebug = debugField;
      job.pauseAfterAudiveris = pauseAfterAudiverisField;
      job.pipelineMode = pipelineModeField;
      job.imagePdfOmrEngine = imagePdfOmrEngineField;
      job.skipPaddleOcr = skipPaddleOcrField;
      job.enablePymupdfReview = enablePymupdfReviewField;
      job.enableOmrStaffReview = enableOmrStaffReviewField;
      job.startStage = startStageField;
      if (!res.headersSent) {
        res.setHeader('X-Accel-Buffering', 'no');
        res.setHeader('X-Pdf2Mxl-Async', '202-after-upload');
        res.status(202).json({ jobId, message: '?ëÏóÖ???ëÏàò?òÏóà?µÎãà?? });
      }
      void executeJob(jobId, bin);
    });
  });

  req.on('error', (e) => {
    failReceive({
      status: 400,
      error: '?ÖÎ°ú???∞Í≤∞ ?§Î•ò',
      detail: e instanceof Error ? e.message : String(e),
    });
  });

  req.pipe(bb);
});

app.get('/api/status/:jobId', (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: '?????ÜÎäî ?ëÏóÖ?ÖÎãà?? });
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
    pipelineMode?: string;
  } = {
    status: job.status,
    pipelineMode: job.pipelineMode,
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
    res.status(404).json({ error: '?????ÜÎäî ?ëÏóÖ?ÖÎãà?? });
    return;
  }
  if (job.status !== 'completed' || !job.result) {
    res.status(409).json({ error: 'Î≥Ä?òÏù¥ ?ÑÏßÅ ?ùÎÇòÏßÄ ?äÏïòÍ±∞ÎÇò ?§Ìå®?àÏäµ?àÎã§' });
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
      .json({ error: 'ÎßàÏä§?π¬∑Ïù∏???êÍ????????àÎäî ?ëÏóÖ???ÑÎãàÍ±∞ÎÇò ÎßåÎ£å?òÏóà?µÎãà?? });
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
    res.status(404).json({ error: 'ÎπÑÍµê??PDFÍ∞Ä ?∏ÏÖò???ÜÏäµ?àÎã§ (omr-work.zip??PDF ?¨Ìï® ?êÎäî clean_score ?ÖÎ°ú??' });
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
    res.status(400).json({ error: '?òÏù¥ÏßÄ Î≤àÌò∏Í∞Ä Î≤îÏúÑÎ•?Î≤óÏñ¥?¨Ïäµ?àÎã§' });
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
    res.status(404).json({ error: '?êÍ? ?Ä???ëÏóÖ???ÑÎãô?àÎã§' });
    return;
  }
  const mxlPath = resolvePrimaryMxlPathForInspect(job);
  if (!mxlPath) {
    res.status(404).json({ error: 'MXL/MusicXML ?åÏùº??Ï∞æÏùÑ ???ÜÏäµ?àÎã§' });
    return;
  }
  try {
    const pythonBin = resolvePythonBin();
    const cacheDir = path.join(job.sessionRoot, '.diag-cache');
    await fs.mkdir(cacheDir, { recursive: true });
    const outXml = path.join(cacheDir, 'inspect-score.musicxml');
    // OMR HITL: raw+HITLÎß???fix_audiveris_mxl¬∑rest ?ïÍ∑ú?îÎäî ?ÅÏö©?òÏ? ?äÏùå
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

app.get('/api/diagnostic/:jobId/debug-zip', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: '?????ÜÎäî ?ëÏóÖ?ÖÎãà?? });
    return;
  }
  if (!fsSync.existsSync(job.sessionRoot)) {
    res.status(404).json({ error: '?∏ÏÖò ?¥ÎçîÍ∞Ä ?¥Î? ??†ú?òÏóà?µÎãà?? });
    return;
  }
  res.setHeader('Content-Type', 'application/zip');
  setAttachmentFilenameHeader(res, `debug-${req.params.jobId}.zip`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    if (!res.headersSent) res.status(500).json({ error: String(err) });
  });
  archive.pipe(res);
  archive.directory(job.sessionRoot, false);
  archive.finalize();
});
app.get('/api/diagnostic/:jobId/masked-pdf', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!diagnosticJobsAllowed(job)) {
    res.status(404).json({ error: 'ÎßàÏä§?π¬∑Ïù∏???êÍ????????àÎäî ?ëÏóÖ???ÑÎãàÍ±∞ÎÇò ÎßåÎ£å?òÏóà?µÎãà?? });
    return;
  }
  const maskedPdfPath = sessionMaskedPdfPath(job.sessionRoot);
  if (!fsSync.existsSync(maskedPdfPath)) {
    res.status(404).json({
      error:
        'masked_input.pdfÍ∞Ä ?ÜÏäµ?àÎã§. OCR¬∑ÎßàÏä§???®Í≥ÑÍ∞Ä ?ÜÏóàÍ±∞ÎÇò, ?ÑÏßÅ ?ùÏÑ±?òÏ? ?äÏïò?????àÏäµ?àÎã§.',
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
    res.status(404).json({ error: 'ÎßàÏä§?π¬∑Ïù∏???êÍ????????àÎäî ?ëÏóÖ???ÑÎãàÍ±∞ÎÇò ÎßåÎ£å?òÏóà?µÎãà?? });
    return;
  }
  let inputPdfPath = job.inputPdfPath;
  if (!inputPdfPath || !fsSync.existsSync(inputPdfPath)) {
    res.status(404).json({ error: '?ÖÎ°ú???êÎ≥∏ PDFÍ∞Ä ?∏ÏÖò???ÜÏäµ?àÎã§' });
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
    res.status(404).json({ error: 'ÎßàÏä§?π¬∑Ïù∏???êÍ????????àÎäî ?ëÏóÖ???ÑÎãàÍ±∞ÎÇò ÎßåÎ£å?òÏóà?µÎãà?? });
    return;
  }
  const cleanScorePath = sessionCleanScorePdfPath(job.sessionRoot);
  if (!fsSync.existsSync(cleanScorePath)) {
    res.status(404).json({
      error:
        'clean_score_only.pdfÍ∞Ä ?ÜÏäµ?àÎã§. ?∞Ìä∏ Î∂ÑÎ¶¨(font_separator) ?åÏù¥?ÑÎùº?∏ÏùÑ ?¨Ïö©?òÏ? ?äÏïòÍ±∞ÎÇò ?ÑÏßÅ ?ùÏÑ±?òÏ? ?äÏïò?????àÏäµ?àÎã§.',
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

/** ÎßàÏä§?π¬∑Ï†êÍ≤Ä ?ëÏóÖ ?∏ÏÖò?êÏÑú Audiveris `-step` Î∞∞Ïπò ?§Ìñâ (`-save`, `-export` ?ÜÏùå). ?úÎ≤Ñ Î∂Ä??Í∞Ä?????ÑÏöî ?úÎßå ?¨Ïö©. */
app.post('/api/diagnostic/:jobId/audiveris-step-probe', express.json({ limit: '48kb' }), async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!audiverisStepProbeJobsAllowed(job)) {
    res.status(404).json({
      error:
        'Audiveris ?®Í≥Ñ ?§Ìñâ???????àÎäî ?ëÏóÖ???ÑÎãàÍ±∞ÎÇò ?∏ÏÖò??ÎßåÎ£å?òÏóà?µÎãà?? ?ÑÎ£å¬∑?§Ìå®¬∑Audiveris Î≥¥Ï†ï ?ÄÍ∏??ÅÌÉú??jobIdÎß?Í∞Ä?•Ìï©?àÎã§.',
    });
    return;
  }
  const bin = resolveAudiverisBin();
  if (!bin) {
    res.status(503).json({ error: 'AUDIVERIS_BIN???§Ï†ï?òÏñ¥ ?àÏ? ?äÏäµ?àÎã§.' });
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
      error: '?†Ìö®?òÏ? ?äÏ? step?ÖÎãà??',
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
      if (tryMasked()) note = 'clean_score_only.pdfÍ∞Ä ?ÜÏñ¥ masked_input.pdfÎ°??§Ìñâ?àÏäµ?àÎã§.';
      else if (tryOrig()) note = 'clean_score_only.pdfÍ∞Ä ?ÜÏñ¥ ?ÖÎ°ú???êÎ≥∏ PDFÎ°??§Ìñâ?àÏäµ?àÎã§.';
    }
  } else if (pdfRequested === 'masked') {
    if (!tryMasked()) {
      if (tryClean()) note = 'masked_input.pdfÍ∞Ä ?ÜÏñ¥ clean_score_only.pdfÎ°??§Ìñâ?àÏäµ?àÎã§.';
      else if (tryOrig()) note = 'ÎßàÏä§??PDFÍ∞Ä ?ÜÏñ¥ ?ÖÎ°ú???êÎ≥∏ PDFÎ°??§Ìñâ?àÏäµ?àÎã§.';
    }
  } else if (!tryOrig()) {
    if (tryClean()) note = '?êÎ≥∏ PDFÎ•?Ï∞æÏ? Î™ªÌï¥ clean_score_only.pdfÎ°??§Ìñâ?àÏäµ?àÎã§.';
    else tryMasked();
  }

  if (!pdfPath) {
    res.status(404).json({
      error: 'Audiveris???òÍ∏∏ PDF(clean_score¬∑masked¬∑original)Î•?Ï∞æÏùÑ ???ÜÏäµ?àÎã§.',
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

/** `POST .../audiveris-step-probe` Í≤∞Í≥º ?¥Îçî ???åÏùº ?§Ïö¥Î°úÎìú. `rel`?Ä ?¥Îãπ ?§Ìñâ ?¥Îçî Í∏∞Ï? ?ÅÎ? Í≤ΩÎ°ú(?? `subdir/book.omr`). */
app.get('/api/diagnostic/:jobId/audiveris-step-probe/:runId/download', async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!audiverisStepProbeJobsAllowed(job)) {
    res.status(404).json({ error: '?ëÏóÖ??Ï∞æÏùÑ ???ÜÍ±∞???®Í≥Ñ ?§Ìñâ Í≤∞Í≥º???ëÍ∑º?????ÜÏäµ?àÎã§.' });
    return;
  }
  const runRoot = path.join(job.sessionRoot, 'audiveris-step-probes', req.params.runId);
  if (!fsSync.existsSync(runRoot)) {
    res.status(404).json({ error: '?¥Îãπ ?§Ìñâ(runId) ?¥ÎçîÍ∞Ä ?ÜÏäµ?àÎã§.' });
    return;
  }
  const rel = req.query.rel;
  if (typeof rel !== 'string' || !rel.trim()) {
    res.status(400).json({ error: 'ÏøºÎ¶¨ rel(?ÅÎ? Í≤ΩÎ°ú)???ÑÏöî?©Îãà??' });
    return;
  }
  const abs = artifactPathWithinRunRoot(runRoot, rel);
  if (!abs || !fsSync.existsSync(abs)) {
    res.status(404).json({ error: '?åÏùº??Ï∞æÏùÑ ???ÜÏäµ?àÎã§.' });
    return;
  }
  try {
    const st = await fs.stat(abs);
    if (!st.isFile()) {
      res.status(400).json({ error: '?åÏùºÎß??§Ïö¥Î°úÎìú?????àÏäµ?àÎã§.' });
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
    res.status(404).json({ error: '?????ÜÎäî ?ëÏóÖ?ÖÎãà?? });
    return;
  }
  if (job.status !== 'font_strip_needed') {
    res.status(400).json({ error: '?∞Ìä∏ ?¨Í∏∞ ?†ÌÉù ?®Í≥ÑÍ∞Ä ?ÑÎãô?àÎã§' });
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
    res.status(404).json({ error: '?∞Ìä∏ ?µÍ≥ÑÍ∞Ä Ï§ÄÎπÑÎêòÏßÄ ?äÏïò?µÎãà?? });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/font-strip/:jobId', express.json({ limit: '256kb' }), async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: '?????ÜÎäî ?ëÏóÖ?ÖÎãà?? });
    return;
  }
  if (job.status !== 'font_strip_needed' || !job.fontStripDeferred) {
    res.status(400).json({ error: '?∞Ìä∏ ?¨Í∏∞ ?†ÌÉù ?ÄÍ∏??ÅÌÉúÍ∞Ä ?ÑÎãô?àÎã§' });
    return;
  }
  const ranges = parseFontStripRangesBody(req.body);
  if (!ranges) {
    res.status(400).json({ error: '{ "ranges": [{ "minPt": number, "maxPt": number }] } ?ïÏãù???ÑÏöî?©Îãà?? });
    return;
  }
  try {
    const prevCfg = await readFontStripConfig(job.sessionRoot);
    await fs.writeFile(
      fontStripConfigPath(job.sessionRoot),
      JSON.stringify(
        {
          ranges,
          savedAt: new Date().toISOString(),
          ...(prevCfg.scoreTitle ? { scoreTitle: prevCfg.scoreTitle } : {}),
        },
        null,
        2,
      ),
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
    res.status(400).json({ error: 'clean_score ÎØ∏Î¶¨Î≥¥Í∏∞ ?®Í≥ÑÍ∞Ä ?ÑÎãô?àÎã§' });
    return;
  }
  let inputPdfPath = job.inputPdfPath;
  const cleanScorePath = sessionCleanScorePdfPath(job.sessionRoot);
  if (!inputPdfPath || !fsSync.existsSync(inputPdfPath) || !fsSync.existsSync(cleanScorePath)) {
    res.status(404).json({ error: 'ÎØ∏Î¶¨Î≥¥Í∏∞ PDFÍ∞Ä Ï§ÄÎπÑÎêòÏßÄ ?äÏïò?µÎãà?? });
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
  if (!titleCandidate?.bbox && fsSync.existsSync(cleanScorePath)) {
    titleCandidate = (await detectScoreTitleFromPdf(pythonBin, scriptSeparator, cleanScorePath)) ?? titleCandidate;
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
  let inputPdfPath = job.inputPdfPath;
  const cleanScorePath = sessionCleanScorePdfPath(job.sessionRoot);
  const pdfPath = source === 'clean_score' ? cleanScorePath : inputPdfPath;
  if (!pdfPath || !fsSync.existsSync(pdfPath)) {
    res.status(404).end();
    return;
  }
  const count = await pdfPageCountViaPython(pdfPath);
  if (!count || !Number.isFinite(page) || page < 1 || page > count) {
    res.status(400).json({ error: '?òÏù¥ÏßÄ Î≤àÌò∏Í∞Ä Î≤îÏúÑÎ•?Î≤óÏñ¥?¨Ïäµ?àÎã§' });
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
    res.status(400).json({ error: 'clean_score ÎØ∏Î¶¨Î≥¥Í∏∞ ?®Í≥ÑÍ∞Ä ?ÑÎãô?àÎã§' });
    return;
  }
  const cleanScorePath = sessionCleanScorePdfPath(job.sessionRoot);
  if (!fsSync.existsSync(cleanScorePath)) {
    res.status(404).json({ error: 'clean_score_only.pdfÍ∞Ä ?ÜÏäµ?àÎã§' });
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
    res.status(400).json({ error: 'clean_score ÎØ∏Î¶¨Î≥¥Í∏∞ ?®Í≥ÑÍ∞Ä ?ÑÎãô?àÎã§' });
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
    res.status(400).json({ error: '?úÎ™© ?çÏä§?∏Í? ?ÑÏöî?©Îãà?? });
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
  const cleanScorePath = sessionCleanScorePdfPath(job.sessionRoot);
  const extractedJsonPath = path.join(job.sessionRoot, 'extracted_music_text.json');
  const scriptSeparator = path.join(__dirname, '..', 'scripts', 'pdf_separator.py');
  const pythonBin = resolvePythonBin();
  if (!bbox) {
    const resolved = await resolveScoreTitleBbox(
      job.sessionRoot,
      cleanScorePath,
      pythonBin,
      scriptSeparator,
      extractedJsonPath,
      prev.bbox,
    );
    if (resolved) bbox = resolved;
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
  let maskRedactions = 0;
  let maskWarning: string | undefined;
  if (!bbox) {
    maskWarning = '?úÎ™© bboxÎ•?Ï∞æÏ? Î™ªÌï¥ PDF ÎßàÏä§?πÏùÑ Í±¥ÎÑà?∞Ïóà?µÎãà?? ?úÎ™© ?ÑÏπòÍ∞Ä pdfplumber¬∑PyMuPDF Î™®Îëê?êÏÑú Î≥¥Ïù¥ÏßÄ ?äÏùÑ ???àÏäµ?àÎã§.';
  } else if (applyMask && scoreTitle.mask !== false && fsSync.existsSync(cleanScorePath)) {
    try {
      maskRedactions = await applyScoreTitleMaskOnPdf(
        pythonBin,
        scriptSeparator,
        job.sessionRoot,
        cleanScorePath,
        scoreTitle,
      );
      if (maskRedactions <= 0) {
        maskWarning =
          '?úÎ™© ?ÅÏó≠ ÎßàÏä§?πÏù¥ ?ÅÏö©?òÏ? ?äÏïò?µÎãà??bbox ?àÏóê ?úÍ±∞???çÏä§?∏¬∑ÎèÑ?ïÏù¥ ?ÜÏùå). clean_score ÎØ∏Î¶¨Î≥¥Í∏∞ PNGÎ•??ïÏù∏?òÏÑ∏??';
      }
    } catch (e) {
      res.status(500).json({ error: `?úÎ™© ?ÅÏó≠ ÎßàÏä§???§Ìå®: ${String(e)}` });
      return;
    }
  }
  res.json({ ok: true, scoreTitle, maskRedactions, maskWarning });
});

app.post('/api/clean-score-preview/:jobId/continue', express.json(), (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'clean_score_preview_needed' || !job.cleanScorePreviewDeferred) {
    res.status(400).json({ error: 'clean_score ÎØ∏Î¶¨Î≥¥Í∏∞ ?ÄÍ∏??ÅÌÉúÍ∞Ä ?ÑÎãô?àÎã§' });
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
    res.status(400).json({ error: 'clean_score ÎØ∏Î¶¨Î≥¥Í∏∞ ?ÄÍ∏??ÅÌÉúÍ∞Ä ?ÑÎãô?àÎã§' });
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
    res.status(404).json({ error: 'lyric_manifest.json???Ä?•Ìï† ???àÎäî ?ëÏóÖ???ÑÎãàÍ±∞ÎÇò ?ÑÏßÅ ?ùÏÑ±?òÏ? ?äÏïò?µÎãà?? });
    return;
  }
  const summary = await readLyricManifestSummary(job.sessionRoot);
  if (!summary) {
    res.status(404).json({ error: 'lyric_manifest.json???ÜÏäµ?àÎã§' });
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
    res.status(404).json({ error: 'lyric_manifest.json???¥Î†§Î∞õÏùÑ ???ÜÏäµ?àÎã§' });
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
    res.status(400).json({ error: 'lyric_manifest ?Ä???ÄÍ∏??ÅÌÉúÍ∞Ä ?ÑÎãô?àÎã§' });
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
    res.status(404).json({ error: '?????ÜÎäî ?ëÏóÖ?ÖÎãà?? });
    return;
  }
  if (job.status !== 'review_needed' || !job.reviewData) {
    res.status(400).json({ error: 'Î¶¨Î∑∞Í∞Ä ?ÑÏöî?òÏ? ?äÍ±∞??Ï§ÄÎπÑÎêòÏßÄ ?äÏïò?µÎãà?? });
    return;
  }
  res.json(job.reviewData);
});

app.get('/api/review/:jobId/lyric-source-info', async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: '?????ÜÎäî ?ëÏóÖ?ÖÎãà?? });
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

/** OMR¬∑HITL ??Í∞Ä??Í≤ÄÏ¶????êÎ≥∏ PDF 1Ï∞?Ï∂îÏ∂ú(?úÎ™©¬∑?ëÍ≥°¬∑Í∞Ä??Î°??òÎèåÎ¶?*/
app.post('/api/review/:jobId/reset-lyrics-initial', async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: '?????ÜÎäî ?ëÏóÖ?ÖÎãà?? });
    return;
  }
  if (job.status !== 'review_needed' || !job.reviewData) {
    res.status(400).json({ error: 'Î¶¨Î∑∞Í∞Ä ?ÑÏöî?òÏ? ?äÍ±∞??Ï§ÄÎπÑÎêòÏßÄ ?äÏïò?µÎãà?? });
    return;
  }
  if (!job.reviewAfterOmr) {
    res.status(400).json({
      error: 'OMR¬∑HITL ?¥ÌõÑ Í∞Ä??Í≤ÄÏ¶??®Í≥Ñ?êÏÑúÎß?Ï¥àÍ∏∞?îÌï† ???àÏäµ?àÎã§',
    });
    return;
  }
  const pdfPath = resolveLyricReviewPdfPath(job);
  if (!pdfPath) {
    res.status(404).json({ error: '?êÎ≥∏ PDFÍ∞Ä ?∏ÏÖò???ÜÏäµ?àÎã§' });
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

/** OMR¬∑HITL ??Í∞Ä??Í≤ÄÏ¶???omr-work.zip???Ä?•Îêú Í∞Ä??Í≤ÄÏ¶??∏Ïßë Î∂àÎü¨?§Í∏∞ */
app.post('/api/review/:jobId/load-saved-lyrics', async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: '?????ÜÎäî ?ëÏóÖ?ÖÎãà?? });
    return;
  }
  if (job.status !== 'review_needed' || !job.reviewData) {
    res.status(400).json({ error: 'Î¶¨Î∑∞Í∞Ä ?ÑÏöî?òÏ? ?äÍ±∞??Ï§ÄÎπÑÎêòÏßÄ ?äÏïò?µÎãà?? });
    return;
  }
  if (!job.reviewAfterOmr) {
    res.status(400).json({
      error: 'OMR¬∑HITL ?¥ÌõÑ Í∞Ä??Í≤ÄÏ¶??®Í≥Ñ?êÏÑúÎß?Î∂àÎü¨?????àÏäµ?àÎã§',
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

/** Î¨∏Ïûê Í≤Ä??Î¶¨Î∑∞) ?®Í≥Ñ: ?êÎ≥∏ PDF Í∞??òÏù¥ÏßÄ ?¨Í∏∞(pt) ???òÎèô Í∞Ä??ÎßàÏä§??Ï¢åÌëú Î≥Ä??*/
app.get('/api/review/:jobId/pdf-dimensions', async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'review_needed') {
    res.status(404).json({ error: 'Î¶¨Î∑∞ Ï§ÄÎπ??ÑÏù¥Í±∞ÎÇò ?ëÏóÖ??Ï∞æÏùÑ ???ÜÏäµ?àÎã§' });
    return;
  }
  const inputPdfPath = resolveLyricReviewPdfPath(job);
  if (!inputPdfPath) {
    res.status(404).json({ error: '?ÖÎ°ú??PDFÍ∞Ä ?∏ÏÖò???ÜÏäµ?àÎã§' });
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

/** Î¨∏Ïûê Í≤Ä???®Í≥Ñ: ???òÏù¥ÏßÄ ÎØ∏Î¶¨Î≥¥Í∏∞ PNG (PDF pt?Ä ?ôÏùº ?∏Î°úÎ∞©Ìñ• Ï¢åÌëú) */
app.get('/api/review/:jobId/pdf-page-png/:pageNum', async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'review_needed') {
    res.status(404).json({ error: 'Î¶¨Î∑∞ Ï§ÄÎπ??ÑÏù¥Í±∞ÎÇò ?ëÏóÖ??Ï∞æÏùÑ ???ÜÏäµ?àÎã§' });
    return;
  }
  const inputPdfPath = resolveLyricReviewPdfPath(job);
  if (!inputPdfPath) {
    res.status(404).json({ error: '?ÖÎ°ú??PDFÍ∞Ä ?∏ÏÖò???ÜÏäµ?àÎã§' });
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
      res.status(400).json({ error: '?òÏù¥ÏßÄ Î≤àÌò∏Í∞Ä Î≤îÏúÑÎ•?Î≤óÏñ¥?¨Ïäµ?àÎã§' });
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

/** Í∞Ä??Í≤ÄÏ¶?UI?????ÑÏû¨ score??part/voiceÎ≥?Í∞Ä???Ä???åÌëú ??*/
app.get('/api/review/:jobId/note-counts', async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: '?????ÜÎäî ?ëÏóÖ?ÖÎãà?? });
    return;
  }
  const mxlPath = resolvePrimaryMxlPathForInspect(job);
  if (!mxlPath || !fsSync.existsSync(mxlPath)) {
    res.status(404).json({ error: '?∏ÏÖò??MusicXML???ÜÏäµ?àÎã§' });
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
    res.status(404).json({ error: 'MXL lintÎ•?Ï°∞Ìöå?????àÎäî ?ëÏóÖ???ÑÎãô?àÎã§' });
    return;
  }
  const mxlPath = resolvePrimaryMxlPathForInspect(job);
  if (!mxlPath) {
    res.status(404).json({ error: 'MXL/MusicXML ?åÏùº??Ï∞æÏùÑ ???ÜÏäµ?àÎã§' });
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
    res.status(404).json({ error: 'OMR ?ïÏ±Ö??Ï°∞Ìöå?????àÎäî ?ëÏóÖ???ÑÎãô?àÎã§' });
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
      'TEXTS(OCR)Í∞Ä SYMBOLS Í∏ÄÎ¶¨ÌîÑÎ•??†Ï†ê ??Audiveris TextWord¬∑OCR eng',
      '?§ÏÑ±Î∂Ä ?∏Î°ú ?ïÎ†¨Î°?tuplet ?´ÏûêÍ∞Ä ??staff?êÎßå Î∂ôÏùå ??SYMBOLS/BEAMS',
      'ÎßàÎîî ??8Î∂??ºÌëú ??RHYTHMS ÎßàÎîî Ï±ÑÏö∞Í∏?heuristic)',
      'ÎßàÎîî Í≤ΩÍ≥Ñ ???úÏÑú ??LINKS/RHYTHMS(heuristic)',
    ],
    lintSummary,
    hints: {
      printedMeasureFormula: '?∏ÏáÑ ÎßàÎîî ??MusicXML measure@number + measureOffsetPrinted ??1',
      symbolsUi: 'SYMBOLS ???§Ïù∏?ùÏ? MXL ?ÑÏ≤òÎ¶¨Îßå?ºÎ°ú???úÍ±∞?òÏ? ?äÏùå ??Audiveris GUI¬∑?îÏßÑ',
      fixMxlScript: 'scripts/fix_audiveris_mxl.py ??direction words P/9 ???ºÎ?',
    },
  });
});

app.get('/api/diagnostic/:jobId/score-parts', async (req, res) => {
  noCacheJson(res);
  const job = jobs.get(req.params.jobId);
  if (!diagnosticJobsAllowed(job)) {
    res.status(404).json({ error: '?åÌä∏ Î™©Î°ù??Ï°∞Ìöå?????àÎäî ?ëÏóÖ???ÑÎãô?àÎã§' });
    return;
  }
  const mxlPath = resolvePrimaryMxlPathForInspect(job);
  try {
    const pythonBin = resolvePythonBin();
    let listed: any[] = [];
    if (mxlPath) {
      try {
        listed = await listScorePartsFromMxl(mxlPath, pythonBin);
      } catch (e) {
        console.warn(`Failed to list score parts from ${mxlPath}`, e);
      }
    }
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
    const partsRaw = (listed.parts || []) as Array<{
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
    res.status(400).json({ error: '?±Î? ?ºÎ≤® ÏßÄ???ÄÍ∏??ÅÌÉúÍ∞Ä ?ÑÎãô?àÎã§' });
    return;
  }
  const body = req.body as { labelsByIndex?: unknown };
  if (!Array.isArray(body.labelsByIndex) || body.labelsByIndex.length < 1) {
    res.status(400).json({ error: 'labelsByIndex Î¨∏Ïûê??Î∞∞Ïó¥???ÑÏöî?©Îãà?? });
    return;
  }
  const labelsByIndex = body.labelsByIndex.map((x) => String(x ?? '').trim());
  if (labelsByIndex.some((l) => !l)) {
    res.status(400).json({ error: 'Î™®Îì† ?åÌä∏???ºÎ≤®??ÏßÄ?ïÌï¥ Ï£ºÏÑ∏?? });
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
    res.status(404).json({ error: '?êÎ≥∏ MXL???¥Î†§Î∞õÏùÑ ???ÜÎäî ?ÅÌÉú?ÖÎãà?? });
    return;
  }
  const p = job.preInjectMxlPaths[0];
  if (!fsSync.existsSync(p)) {
    res.status(404).json({ error: 'MXL ?åÏùº???ÜÏäµ?àÎã§' });
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
    res.status(404).json({ error: 'OMR HITL Î≥¥Ï†ï??Ï°∞Ìöå?????àÎäî ?ëÏóÖ???ÑÎãô?àÎã§' });
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
    res.status(400).json({ error: 'OMR ?àÏßà Í≤Ä???ÄÍ∏?Ï§ëÏóêÎß?Î≥¥Ï†ï???Ä?•Ìï† ???àÏäµ?àÎã§' });
    return;
  }
  const body = req.body as { fixes?: unknown };
  if (!Array.isArray(body.fixes)) {
    res.status(400).json({ error: 'fixes Î∞∞Ïó¥???ÑÏöî?©Îãà?? });
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
    res.status(404).json({ error: 'ÎßàÎîî Ï°∞ÌöåÎ•??????àÎäî ?ëÏóÖ???ÑÎãô?àÎã§' });
    return;
  }
  const partId = typeof req.query.partId === 'string' ? req.query.partId.trim() : '';
  const measureMxl = typeof req.query.measureMxl === 'string' ? req.query.measureMxl.trim() : '';
  if (!partId || !measureMxl) {
    res.status(400).json({ error: 'partId, measureMxl ÏøºÎ¶¨Í∞Ä ?ÑÏöî?©Îãà?? });
    return;
  }
  const mxlPath = resolvePrimaryMxlPathForInspect(job);
  if (!mxlPath) {
    res.status(404).json({ error: 'MXL ?åÏùº??Ï∞æÏùÑ ???ÜÏäµ?àÎã§' });
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
    res.status(400).json({ error: 'OMR ?àÏßà Í≤Ä???ÄÍ∏?Ï§ëÏóêÎß?Î≥¥Ï†ï???ÅÏö©?????àÏäµ?àÎã§' });
    return;
  }
  const mxlPath = resolvePrimaryMxlPathForInspect(job);
  if (!mxlPath) {
    res.status(404).json({ error: 'MXL ?åÏùº??Ï∞æÏùÑ ???ÜÏäµ?àÎã§' });
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
    res.status(400).json({ error: 'OMR ?àÏßà Í≤Ä???ÄÍ∏?Ï§ëÏóêÎß??êÎèô ?ïÎ¶¨Î•??§Ìñâ?????àÏäµ?àÎã§' });
    return;
  }
  const mxlPath = resolvePrimaryMxlPathForInspect(job);
  if (!mxlPath) {
    res.status(404).json({ error: 'MXL ?åÏùº??Ï∞æÏùÑ ???ÜÏäµ?àÎã§' });
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
    res.status(400).json({ error: 'OMR ?àÏßà Í≤Ä???ÄÍ∏?Ï§ëÏóêÎß?ÎØ∏Î¶¨Î≥¥Í∏∞Î•??ôÍ∏∞?îÌï† ???àÏäµ?àÎã§' });
    return;
  }
  const mxlPath = resolvePrimaryMxlPathForInspect(job);
  if (!mxlPath) {
    res.status(404).json({ error: 'MXL ?åÏùº??Ï∞æÏùÑ ???ÜÏäµ?àÎã§' });
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
    res.status(400).json({ error: 'OMR ?àÏßà Í≤Ä???ÄÍ∏?Ï§ëÏóêÎß??ëÏóÖ???¥Î≥¥?????àÏäµ?àÎã§' });
    return;
  }
  const mxlPath = resolvePrimaryMxlPathForInspect(job);
  if (!mxlPath || !fsSync.existsSync(mxlPath)) {
    res.status(404).json({ error: 'MXL ?åÏùº??Ï∞æÏùÑ ???ÜÏäµ?àÎã§' });
    return;
  }
  try {
    const pythonBin = resolvePythonBin();
    await syncOmrReviewMxl(job.sessionRoot, mxlPath, pythonBin);
    await invalidateInspectScoreCache(job.sessionRoot);
  } catch (e) {
    res.status(500).json({ error: `?Ä????MXL ?ôÍ∏∞???§Ìå®: ${String(e)}` });
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
  const deskewedPdfPath = path.join(job.sessionRoot, 'deskewed.pdf');
  if (fsSync.existsSync(deskewedPdfPath)) {
    archive.file(deskewedPdfPath, { name: 'deskewed.pdf' });
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
    res.status(400).json({ error: 'OMR ?àÏßà Í≤Ä???ÄÍ∏?Ï§ëÏóêÎß??ëÏóÖ??Î∂àÎü¨?????àÏäµ?àÎã§' });
    return;
  }
  const mxlPath = resolvePrimaryMxlPathForInspect(job);
  if (!mxlPath) {
    res.status(404).json({ error: 'MXL ?åÏùº??Ï∞æÏùÑ ???ÜÏäµ?àÎã§' });
    return;
  }
  const bb = busboy({ headers: req.headers, limits: { fileSize: 80 * 1024 * 1024, files: 1 } });
  let zipPath: string | null = null;
  let importErr: string | null = null;
  bb.on('file', (_name, file, info) => {
    if (!info.filename.toLowerCase().endsWith('.zip')) {
      importErr = 'ZIP ?åÏùºÎß??ÖÎ°ú?úÌï† ???àÏäµ?àÎã§';
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
        res.status(400).json({ error: '?ÖÎ°ú?úÎêú ZIP???ÜÏäµ?àÎã§' });
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
        error: '?ëÏóÖ??Ï∞æÏùÑ ???ÜÏäµ?àÎã§. ?úÎ≤Ñ ?¨Ïãú??pm2 restart) ?ÑÏóê??Î≥Ä?òÏùÑ Ï≤òÏùåÎ∂Ä???§Ïãú ?úÏûë?òÏÑ∏??',
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
          ? '?±Î? ?ºÎ≤® ÏßÄ??Î™®Îã¨?êÏÑú ?ïÏ†ï????OMR Í≤Ä???®Í≥ÑÎ°??òÏñ¥Í∞Ä?∏Ïöî.'
          : `?ÑÏû¨ ?ÅÌÉú: ${job.status}`;
      res.status(400).json({ error: 'OMR ?òÏù¥ÏßÄ¬∑?±Î? Í≤Ä???ÄÍ∏??ÅÌÉúÍ∞Ä ?ÑÎãô?àÎã§', detail: hint });
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
    res.status(400).json({ error: 'Audiveris Î≥¥Ï†ï ?ÄÍ∏??ÅÌÉúÍ∞Ä ?ÑÎãô?àÎã§' });
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
    error: 'Content-Type?Ä application/json ?êÎäî multipart/form-data ?¨Ïïº ?©Îãà??,
  });
});

app.get('/api/deskew/:jobId', async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || !job.deskewAnglesPath || !fsSync.existsSync(job.deskewAnglesPath)) {
    res.status(404).json({ error: 'Í∞ÅÎèÑ ?∞Ïù¥?∞Î? Ï∞æÏùÑ ???ÜÏäµ?àÎã§' });
    return;
  }
  try {
    const data = await fs.readFile(job.deskewAnglesPath, 'utf8');
    res.json(JSON.parse(data));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/deskew/:jobId/page/:pageNum/png', async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || !job.inputPdfPath) {
    res.status(404).send('PDF not found');
    return;
  }
  const page = parseInt(req.params.pageNum, 10);
  try {
    const dpi = 264; // High resolution for deskew preview
    const cacheFile = await renderSessionPagePng(job, job.inputPdfPath, page, dpi, 'deskew-preview');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=120');
    res.sendFile(path.resolve(cacheFile));
  } catch (err) {
    console.error(`[deskew] render-page error:`, err);
    if (!res.headersSent) res.status(500).send('Render failed');
  }
});

app.get('/api/deskew/:jobId/pdf', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).send('Job not found');
    return;
  }
  const deskewedPdfPath = path.join(job.sessionRoot, 'deskewed.pdf');
  if (!fsSync.existsSync(deskewedPdfPath)) {
    res.status(404).send('Deskewed PDF not found');
    return;
  }
  setAttachmentFilenameHeader(res, `${job.originalName || 'deskewed'}-deskewed.pdf`);
  res.sendFile(deskewedPdfPath);
});

app.get('/api/deskew/:jobId/clean-score-pdf', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).send('Job not found');
    return;
  }
  const cleanScorePdfPath = path.join(job.sessionRoot, 'clean_score_only.pdf');
  if (!fsSync.existsSync(cleanScorePdfPath)) {
    res.status(404).send('Clean score PDF not found');
    return;
  }
  setAttachmentFilenameHeader(res, `${job.originalName || 'deskewed'}-clean-score-only.pdf`);
  res.sendFile(cleanScorePdfPath);
});

app.post('/api/deskew/:jobId/finish', async (req, res) => {
  const jobId = req.params.jobId;
  const job = jobs.get(jobId);
  if (!job || job.status !== 'deskew_save_needed' || !job.deskewSaveDeferred) {
    return res.status(400).json({ error: 'Job not in deskew save pending state' });
  }

  try {
    job.deskewSaveDeferred.resolve();
    return res.json({ status: 'ok' });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

app.post('/api/deskew/:jobId/continue', express.json(), async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: '?ëÏóÖ??Ï∞æÏùÑ ???ÜÏäµ?àÎã§' });
    return;
  }
  if (job.status !== 'deskew_needed' || !job.deskewDeferred) {
    res.status(400).json({ error: '?ÑÏû¨ ?ëÏóÖ??deskew Í≤Ä???ÄÍ∏??ÅÌÉúÍ∞Ä ?ÑÎãô?àÎã§' });
    return;
  }
  try {
    const newAngles = req.body;
    if (Array.isArray(newAngles)) {
      if (job.deskewAnglesPath) {
        await fs.writeFile(job.deskewAnglesPath, JSON.stringify(newAngles, null, 2), 'utf8');
      }
    }
    job.deskewDeferred.resolve();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});


app.post('/api/review/:jobId', express.json({ limit: '10mb' }), async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: '?????ÜÎäî ?ëÏóÖ?ÖÎãà?? });
    return;
  }
  if (job.status !== 'review_needed' || !job.reviewDeferred) {
    res.status(400).json({ error: '?ÑÏû¨ ?ëÏóÖ??Î¶¨Î∑∞ ?ÄÍ∏??ÅÌÉúÍ∞Ä ?ÑÎãô?àÎã§' });
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
          'Î≥∏Î¨∏?Ä ??™© Î∞∞Ïó¥?¥Í±∞??{ "items": [...], "transposeSemitones"?: number } ?ïÏãù?¥Ïñ¥???©Îãà??,
      });
      return;
    }

    const reviewSavePath = path.join(job.sessionRoot, 'ocr_data_pymupdf.json');
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
