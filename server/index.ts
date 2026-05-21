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

import {
  AUDIVERIS_SHEET_STEPS,
  audiverisExtraCliArgsFromEnv,
  audiverisLogSuggestsHumanReview,
  buildAudiverisStepProbeArgv,
  collectMusicXmlOutputs,
  isAudiverisSheetStep,
  ocrLanguageConstantArgsFromEnv,
  parseAudiverisSheetsSpec,
  resolveAudiverisBin,
  runAudiveris,
  runAudiverisArgv,
} from '../shared/audiveris.js';

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

function resolvedAudiverisOcrLangSpec(): string | null {
  const raw = process.env.AUDIVERIS_OCR_LANG;
  if (raw === '') return null;
  const spec = (raw ?? 'kor+eng').trim();
  return spec || null;
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

app.get('/api/health', (_req, res) => {
  const bin = resolveAudiverisBin();
  const ocrLangEffective = resolvedAudiverisOcrLangSpec();
  const ocrLangConstantInjected = ocrLanguageConstantArgsFromEnv().length > 0;
  const extraCli = audiverisExtraCliArgsFromEnv();
  res.json({
    ok: true,
    audiverisConfigured: Boolean(bin),
    audiverisOcrLangEffective: ocrLangEffective,
    audiverisOcrLangConstantInjected: ocrLangConstantInjected,
    audiverisCliExtraArgCount: extraCli.length,
    audiverisPauseOnWarn: audiverisPauseOnWarnFromEnv(),
    audiverisWarnPattern: process.env.AUDIVERIS_WARN_PATTERN?.trim() || null,
    hint: bin ? undefined : 'Set AUDIVERIS_BIN to Audiveris.bat or bin/Audiveris',
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
  | 'review_needed'
  | 'audiveris_review_needed'
  | 'completed'
  | 'failed';

type JobProgressPhase = 'upload' | 'audiveris';

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
  /** Audiveris 직후 보정 단계용 */
  pauseAfterAudiveris?: boolean;
  preInjectMxlPaths?: string[];
  audiverisReviewDeferred?: { resolve: () => void; reject: (err: Error) => void };
  injectMxlPathsOverride?: string[];
};

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

function diagnosticJobsAllowed(job: JobRecord | undefined): job is JobRecord {
  return Boolean(
    job &&
      (job.status === 'completed' ||
        job.status === 'audiveris_review_needed' ||
        job.status === 'failed'),
  );
}

/** 완료·보정 대기·실패 작업만 — 세션 폴더에 PDF가 남아 단계 디버깅을 돌릴 수 있는 경우 */
function audiverisStepProbeJobsAllowed(job: JobRecord | undefined): job is JobRecord {
  if (!job?.sessionRoot || !fsSync.existsSync(job.sessionRoot)) return false;
  return (
    job.status === 'completed' ||
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

function resolvePrimaryMxlPathForInspect(job: JobRecord): string | null {
  if (job.status === 'audiveris_review_needed' && job.preInjectMxlPaths?.length) {
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

function diagnosticPdfDownloadBaseName(job: JobRecord, kind: 'masked' | 'original'): string {
  const base = path.basename(job.originalName, path.extname(job.originalName)) || 'score';
  return kind === 'masked' ? `${base}-masked-audiveris-input` : `${base}-upload-original`;
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

async function executeJob(jobId: string, audiverisBin: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job || !job.inputPdfPath) return;

  const { sessionRoot, inputPdfPath, originalName, isDebug } = job;
  const outBase = path.join(sessionRoot, 'audiveris-out');
  const wipeSession = () => fs.rm(sessionRoot, { recursive: true, force: true }).catch(() => {});

  const fail = async (payload: JobErrorPayload) => {
    await wipeSession();
    job.status = 'failed';
    job.error = payload;
    job.finishedAt = Date.now();
    delete job.progress;
  };

  job.status = 'processing';

  try {
    await fs.mkdir(outBase, { recursive: true });

    const pageHint = job.pdfPageCount && job.pdfPageCount > 0 ? job.pdfPageCount : 1;
    const pythonBin = resolvePythonBin();

    // Phase 1: Text Extraction (Pre-Audiveris)
    setJobProgress(job, {
      phase: 'upload',
      current: 1,
      total: 1,
      detail: 'PDF에서 문자 추출 중 (PyMuPDF / PaddleOCR)…',
    });

    const scriptExtract = path.join(__dirname, '..', 'scripts', 'extract_text.py');
    const ocrJsonPath = path.join(sessionRoot, 'ocr_data.json');
    
    console.log(`[job ${jobId}] Running extract_text.py using ${pythonBin}`);
    const { stdout, stderr } = await exec(`"${pythonBin}" "${scriptExtract}" "${inputPdfPath}" "${ocrJsonPath}"`);
    if (stdout) console.log(`[job ${jobId}] extract_text.py Output:\n${stdout}`);
    if (stderr) console.error(`[job ${jobId}] extract_text.py Error:\n${stderr}`);

    // Phase 2: UI Review
    if (fsSync.existsSync(ocrJsonPath)) {
      const ocrData = JSON.parse(await fs.readFile(ocrJsonPath, 'utf8'));
      
      console.log(`[job ${jobId}] Pausing for UI review...`);
      job.status = 'review_needed';
      job.reviewData = ocrData;
      
      await new Promise<void>((resolve, reject) => {
        job.reviewDeferred = { resolve, reject };
      });
      
      console.log(`[job ${jobId}] Review completed, resuming...`);
      job.status = 'processing';
    }

    // Phase 3: Masking
    setJobProgress(job, {
      phase: 'audiveris',
      current: 0,
      total: pageHint,
      detail: 'PDF 마스킹 및 Audiveris 준비 중…',
    });
    
    const scriptMask = path.join(__dirname, '..', 'scripts', 'mask_pdf.py');
    const maskedPdfPath = path.join(sessionRoot, 'masked_input.pdf');
    if (fsSync.existsSync(ocrJsonPath)) {
       console.log(`[job ${jobId}] Running mask_pdf.py using ${pythonBin}`);
       await exec(`"${pythonBin}" "${scriptMask}" "${inputPdfPath}" "${maskedPdfPath}" "${ocrJsonPath}"`);
    }

    // Use masked pdf if it exists, otherwise use original
    const pdfToProcess = fsSync.existsSync(maskedPdfPath) ? maskedPdfPath : inputPdfPath;

    // Phase 4: Audiveris
    console.log(`[job ${jobId}] Running Audiveris on ${pdfToProcess}...`);
    setJobProgress(job, {
      phase: 'audiveris',
      current: 0,
      total: pageHint,
      detail: 'Audiveris 악보 인식 중…',
    });

    const result = await runAudiveris({
      audiverisBin,
      outputBaseDir: outBase,
      inputPdfPath: pdfToProcess,
      onStreamLine: (_stream, line) => {
        const parsed = parseAudiverisProgressLine(line, job.pdfPageCount ?? 0);
        if (parsed) {
          setJobProgress(jobs.get(jobId), {
            phase: 'audiveris',
            current: parsed.current,
            total: parsed.total,
            detail: 'Audiveris 처리',
          });
        }
      },
    });

    const outputs = await collectMusicXmlOutputs(outBase);

    let mxlForInject = outputs.filter((p) => p.toLowerCase().endsWith('.mxl'));

    const autoPauseFromAudiverisLog = audiverisLogSuggestsHumanReview(
      result.stdout,
      result.stderr,
    );
    if (autoPauseFromAudiverisLog) {
      console.log(
        `[job ${jobId}] AUDIVERIS_PAUSE_ON_WARN: 로그에 WARN 등이 감지되어 Audiveris 보정(HITL) 단계로 전환합니다.`,
      );
    }
    const pauseForAudiverisReview = job.pauseAfterAudiveris || autoPauseFromAudiverisLog;

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

    // Phase 5: Inject
    if (mxlForInject.length > 0 && fsSync.existsSync(ocrJsonPath)) {
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
            `"${pythonBin}" "${scriptInject}" "${p}" "${p}" "${ocrJsonPath}"`,
          );
          if (stdoutInj) console.log(`[job ${jobId}] inject_ocr.py Output:\n${stdoutInj}`);
          if (stderrInj) console.error(`[job ${jobId}] inject_ocr.py Error:\n${stderrInj}`);
        }
      }
    }

    if (outputs.length === 0) {
      await fail({
        status: 422,
        error: 'Audiveris가 MusicXML/MXL을 만들지 못했습니다',
        detail:
          'Audiveris 출력 폴더에 .mxl/.musicxml이 없습니다. 로그의 WARN [#N]·ERS 등은 보통 해당 장 처리 내보내기 문제를 뜻하며, 한 장이라도 실패하면 파일이 없을 수 있습니다. Audiveris GUI로 동일 PDF를 열어 오류를 확인하거나 디버그 ZIP의 로그를 검토하세요.',
        exitCode: result.code ?? undefined,
        stdoutTail: tail(result.stdout),
        stderrTail: tail(result.stderr),
      });
      return;
    }

    const baseName = path.basename(originalName, path.extname(originalName)) || 'score';

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

app.post('/api/convert', (req, res) => {
  const bin = resolveAudiverisBin();
  if (!bin) {
    res.status(503).json({
      error: 'AUDIVERIS_BIN is not set',
      detail:
        'Linux: export AUDIVERIS_BIN=/opt/audiveris/bin/Audiveris  |  Windows: Audiveris.bat 경로',
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
  let sawPdfField = false;
  let pdfWriteChain: Promise<void> = Promise.resolve();

  const bb = busboy({
    headers: req.headers,
    defParamCharset: 'utf8',
    limits: { fileSize: MAX_UPLOAD_BYTES },
  });

  bb.on('field', (name, val) => {
    if (name === 'debug' && val === 'true') debugField = true;
    if (name === 'pauseAfterAudiveris' && val === 'true') pauseAfterAudiverisField = true;
  });

  bb.on('file', (name, file, info) => {
    if (name !== 'pdf') {
      file.resume();
      return;
    }
    if (sawPdfField) {
      file.resume();
      return;
    }
    sawPdfField = true;

    const job = jobs.get(jobId);
    if (!job) {
      file.resume();
      return;
    }

    const diskName = safeUploadBasename(info.filename);
    const destPath = path.join(sessionRoot, diskName);
    const originalDisplayName = decodeMultipartFilename(info.filename);
    job.originalName = originalDisplayName;

    setJobProgress(job, {
      phase: 'upload',
      current: 0,
      total: 1,
      detail: 'PDF 파일 저장 중…',
    });

    const ws = createWriteStream(destPath);
    file.on('limit', () => {
      failReceive({
        status: 400,
        error: '파일이 너무 큽니다',
        detail: `최대 ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB`,
      });
    });

    pdfWriteChain = pdfWriteChain.then(() =>
      pipeline(file, ws)
        .then(() => {
          const j = jobs.get(jobId);
          if (!j || receiveSettled) return;
          j.inputPdfPath = destPath;
          setJobProgress(j, {
            phase: 'upload',
            current: 1,
            total: 1,
            detail: '업로드 완료, Audiveris 준비 중…',
          });
        })
        .catch((e) =>
          failReceive({
            status: 500,
            error: '업로드 저장 실패',
            detail: e instanceof Error ? e.message : String(e),
          }),
        ),
    );
  });

  bb.on('error', (e) => {
    failReceive({
      status: 400,
      error: 'multipart 처리 오류',
      detail: e instanceof Error ? e.message : String(e),
    });
  });

  bb.on('finish', () => {
    void pdfWriteChain.then(() => {
      if (receiveSettled) return;
      const job = jobs.get(jobId);
      if (!job) return;
      if (!sawPdfField) {
        failReceive({
          status: 400,
          error: 'pdf 파일 필드가 필요합니다',
          detail: 'multipart field name: pdf',
        });
        return;
      }
      if (!job.inputPdfPath) {
        failReceive({
          status: 500,
          error: '업로드가 완료되지 않았습니다',
        });
        return;
      }
      job.isDebug = debugField;
      job.pauseAfterAudiveris = pauseAfterAudiverisField;
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

  const payload: { status: JobStatus; progress?: JobProgress } = { status: job.status };
  if (job.progress && (job.status === 'pending' || job.status === 'processing')) {
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
  const inputPdfPath = job.inputPdfPath;
  if (!inputPdfPath || !fsSync.existsSync(inputPdfPath)) {
    res.status(404).json({ error: '업로드 원본 PDF가 세션에 없습니다' });
    return;
  }
  const maskedPdfPath = path.join(job.sessionRoot, 'masked_input.pdf');
  const maskedExists = fsSync.existsSync(maskedPdfPath);
  const [origCount, maskedCount] = await Promise.all([
    pdfPageCountViaPython(inputPdfPath),
    maskedExists ? pdfPageCountViaPython(maskedPdfPath) : Promise.resolve(null),
  ]);
  const pageCountForUi = origCount ?? maskedCount ?? job.pdfPageCount ?? 1;
  const mxlPath = resolvePrimaryMxlPathForInspect(job);
  res.json({
    jobId: req.params.jobId,
    status: job.status,
    originalName: job.originalName,
    originalPdf: { exists: true, pageCount: origCount },
    maskedPdf: { exists: maskedExists, pageCount: maskedExists ? maskedCount : null },
    pageCountForUi: Math.max(1, pageCountForUi),
    pageCountsMatch:
      !maskedExists ||
      origCount == null ||
      maskedCount == null ||
      origCount === maskedCount,
    scoreMusicXmlAvailable: Boolean(mxlPath),
  });
});

app.get('/api/diagnostic/:jobId/page/:pageNum/png', async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!diagnosticJobsAllowed(job)) {
    res.status(404).end();
    return;
  }
  const source = (req.query.source as string) === 'masked' ? 'masked' : 'original';
  const page = parseInt(req.params.pageNum, 10);
  const dpiRaw = parseInt(String(req.query.dpi ?? '132'), 10);
  const dpi = Number.isFinite(dpiRaw) ? Math.min(240, Math.max(72, dpiRaw)) : 132;

  const inputPdfPath = job.inputPdfPath;
  if (!inputPdfPath || !fsSync.existsSync(inputPdfPath)) {
    res.status(404).end();
    return;
  }
  const maskedPdfPath = path.join(job.sessionRoot, 'masked_input.pdf');
  const pdfPath =
    source === 'masked'
      ? maskedPdfPath
      : inputPdfPath;
  if (!fsSync.existsSync(pdfPath)) {
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
    const cacheFile = path.join(cacheDir, `p${page}-${source}-dpi${dpi}.png`);
    let needRender = true;
    if (fsSync.existsSync(cacheFile)) {
      const [stPdf, stPng] = await Promise.all([fs.stat(pdfPath), fs.stat(cacheFile)]);
      if (stPng.mtimeMs >= stPdf.mtimeMs) needRender = false;
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
    const cacheDir = path.join(job.sessionRoot, '.diag-cache');
    await fs.mkdir(cacheDir, { recursive: true });
    const outXml = path.join(cacheDir, 'inspect-score.musicxml');
    let needExtract = true;
    if (fsSync.existsSync(outXml) && fsSync.existsSync(mxlPath)) {
      const [stM, stX] = await Promise.all([fs.stat(mxlPath), fs.stat(outXml)]);
      if (stX.mtimeMs >= stM.mtimeMs) needExtract = false;
    }
    if (needExtract) {
      const mxlScript = path.join(__dirname, '..', 'scripts', 'mxl_to_musicxml_file.py');
      const pythonBin = resolvePythonBin();
      await exec(`"${pythonBin}" "${mxlScript}" "${mxlPath}" "${outXml}"`, {
        maxBuffer: 40 * 1024 * 1024,
      });
    }
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
  const maskedPdfPath = path.join(job.sessionRoot, 'masked_input.pdf');
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
  const pdfRequested = body.pdfSource === 'original' ? 'original' : 'masked';

  const maskedPdfPath = path.join(job.sessionRoot, 'masked_input.pdf');
  const origPath = job.inputPdfPath;

  let pdfPath: string | null = null;
  let pdfUsed: 'masked' | 'original' = 'original';
  let note: string | undefined;

  if (pdfRequested === 'masked') {
    if (fsSync.existsSync(maskedPdfPath)) {
      pdfPath = maskedPdfPath;
      pdfUsed = 'masked';
    } else if (origPath && fsSync.existsSync(origPath)) {
      pdfPath = origPath;
      pdfUsed = 'original';
      note = '마스킹 PDF가 없어 업로드 원본 PDF로 실행했습니다.';
    }
  } else {
    if (origPath && fsSync.existsSync(origPath)) {
      pdfPath = origPath;
      pdfUsed = 'original';
    }
  }

  if (!pdfPath) {
    res.status(404).json({
      error:
        pdfRequested === 'masked'
          ? '마스킹 PDF와 원본 PDF를 찾을 수 없습니다.'
          : '업로드 원본 PDF를 찾을 수 없습니다.',
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

app.get('/api/raw-mxl/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (
    !job ||
    job.status !== 'audiveris_review_needed' ||
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

    const ocrJsonPath = path.join(job.sessionRoot, 'ocr_data.json');
    await fs.writeFile(ocrJsonPath, JSON.stringify(items, null, 2), 'utf8');
    await mergeOcrMetaTranspose(job.sessionRoot, transposeSemitones);

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
