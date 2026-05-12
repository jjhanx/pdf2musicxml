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
  collectMusicXmlOutputs,
  ocrLanguageConstantArgsFromEnv,
  resolveAudiverisBin,
  runAudiveris,
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

app.get('/api/health', (_req, res) => {
  const bin = resolveAudiverisBin();
  const ocrLangEffective = resolvedAudiverisOcrLangSpec();
  const ocrLangConstantInjected = ocrLanguageConstantArgsFromEnv().length > 0;
  res.json({
    ok: true,
    audiverisConfigured: Boolean(bin),
    audiverisOcrLangEffective: ocrLangEffective,
    audiverisOcrLangConstantInjected: ocrLangConstantInjected,
    hint: bin ? undefined : 'Set AUDIVERIS_BIN to Audiveris.bat or bin/Audiveris',
    jobRetentionHours: JOB_RETENTION_HOURS,
    jobRetentionNote:
      '변환 완료 또는 실패 처리 후 서버에 보관되는 작업·파일은 24시간이 지나면 자동으로 삭제됩니다.',
  });
});

type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

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

    console.log(`[job ${jobId}] Running Audiveris...`);
    setJobProgress(job, {
      phase: 'audiveris',
      current: 0,
      total: pageHint,
      detail: 'Audiveris 악보 인식 중…',
    });

    const result = await runAudiveris({
      audiverisBin,
      outputBaseDir: outBase,
      inputPdfPath,
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

    if (outputs.length > 0) {
      setJobProgress(job, {
        phase: 'audiveris',
        current: pageHint,
        total: pageHint,
        detail: 'MusicXML 후처리 (조표/가사 보정) 중…',
      });
      for (const p of outputs) {
        if (p.endsWith('.mxl')) {
          const scriptPath = path.join(__dirname, '..', 'scripts', 'postprocess_mxl.py');
          try {
            console.log(`[job ${jobId}] Running postprocess_mxl.py for ${p}`);
            await exec(`python "${scriptPath}" "${inputPdfPath}" "${p}" "${p}"`);
          } catch (pyErr) {
            console.error(`[job ${jobId}] Post-processing failed for ${p}:`, pyErr);
          }
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
  let sawPdfField = false;
  let pdfWriteChain: Promise<void> = Promise.resolve();

  const bb = busboy({
    headers: req.headers,
    defParamCharset: 'utf8',
    limits: { fileSize: MAX_UPLOAD_BYTES },
  });

  bb.on('field', (name, val) => {
    if (name === 'debug' && val === 'true') debugField = true;
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

function streamZipToResponse(
  res: express.Response,
  result: Extract<JobResult, { kind: 'zip' }>,
  wipeSession: () => Promise<void>,
): void {
  res.setHeader('Content-Type', 'application/zip');
  const zipAscii = result.zipName.replace(/[^\x20-\x7E]/g, '_');
  const zipEncoded = encodeURIComponent(result.zipName);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${zipAscii}"; filename*=UTF-8''${zipEncoded}`,
  );

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', async (err: Error) => {
    await wipeSession();
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
      await wipeSession();
      if (!res.headersSent) res.status(500).end(String(err));
    }
  })();
  res.once('finish', wipeSession);
  res.once('close', wipeSession);
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

  const sessionRoot = job.sessionRoot;
  const wipeSession = () => fs.rm(sessionRoot, { recursive: true, force: true }).catch(() => {});

  if (job.result.kind === 'single') {
    const { filePath, downloadBaseName, ext } = job.result;
    res.setHeader('Content-Type', 'application/octet-stream');
    const asciiName = `${downloadBaseName}${ext}`.replace(/[^\x20-\x7E]/g, '_');
    const encodedName = encodeURIComponent(`${downloadBaseName}${ext}`);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
    );
    let cleaned = false;
    const cleanupJob = async () => {
      if (cleaned) return;
      cleaned = true;
      jobs.delete(req.params.jobId);
      await wipeSession();
    };
    const rs = fsSync.createReadStream(filePath);
    rs.on('error', () => {
      void cleanupJob();
    });
    res.once('finish', () => {
      void cleanupJob();
    });
    res.once('close', () => {
      void cleanupJob();
    });
    rs.pipe(res);
    return;
  }

  let zipCleaned = false;
  const zipCleanup = async () => {
    if (zipCleaned) return;
    zipCleaned = true;
    jobs.delete(req.params.jobId);
    await wipeSession();
  };

  streamZipToResponse(res, job.result, zipCleanup);
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
