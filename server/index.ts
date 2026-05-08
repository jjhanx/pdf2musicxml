import archiver from 'archiver';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execCallback);

import {
  collectMusicXmlOutputs,
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

let defaultPython = process.platform === 'win32' ? 'python' : 'python3';
if (fsSync.existsSync(path.join(__dirname, '..', 'venv', 'bin', 'python'))) {
  defaultPython = path.join(__dirname, '..', 'venv', 'bin', 'python');
} else if (fsSync.existsSync(path.join(__dirname, '..', 'venv', 'Scripts', 'python.exe'))) {
  defaultPython = path.join(__dirname, '..', 'venv', 'Scripts', 'python.exe');
}
const pythonCmd = process.env.PYTHON_BIN || defaultPython;

const app = express();
app.use(cors({ origin: true }));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'pdf2mxl-up-'));
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      // multer decodes multipart headers as latin1 by default. Convert back to utf8.
      file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const safe = path.basename(file.originalname).replace(/[^\w.\-\uAC00-\uD7A3\s]+/g, '_');
      cb(null, safe || 'input.pdf');
    },
  }),
  limits: { fileSize: 80 * 1024 * 1024 },
});

app.get('/api/health', (_req, res) => {
  const bin = resolveAudiverisBin();
  res.json({
    ok: true,
    audiverisConfigured: Boolean(bin),
    hint: bin ? undefined : 'Set AUDIVERIS_BIN to Audiveris.bat or bin/Audiveris',
    jobRetentionHours: JOB_RETENTION_HOURS,
    jobRetentionNote:
      '변환 완료 또는 실패 처리 후 서버에 보관되는 작업·파일은 24시간이 지나면 자동으로 삭제됩니다.',
  });
});

type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

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
      maskedPdfPath: string;
      textDataPath: string;
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
  inputPdfPath: string;
  isDebug: boolean;
  createdAt: number;
  /** 변환이 끝난 시점(성공 또는 최종 실패 판정). TTL 기준. */
  finishedAt?: number;
  error?: JobErrorPayload;
  result?: JobResult;
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

function tail(s: string, max = 8000): string {
  if (s.length <= max) return s;
  return s.slice(-max);
}

async function executeJob(jobId: string, audiverisBin: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  const { sessionRoot, inputPdfPath, originalName, isDebug } = job;
  const outBase = path.join(sessionRoot, 'audiveris-out');
  const wipeSession = () => fs.rm(sessionRoot, { recursive: true, force: true }).catch(() => {});

  const fail = async (payload: JobErrorPayload) => {
    await wipeSession();
    job.status = 'failed';
    job.error = payload;
    job.finishedAt = Date.now();
  };

  job.status = 'processing';

  try {
    await fs.mkdir(outBase, { recursive: true });

    const maskedPdfPath = path.join(sessionRoot, 'masked_input.pdf');
    const textDataPath = path.join(sessionRoot, 'text_data.json');
    const extractorScript = path.join(__dirname, '..', 'scripts', 'pdf_text_extractor.py');

    console.log(`[job ${jobId}] Running text extraction...`);
    try {
      await exec(
        `"${pythonCmd}" "${extractorScript}" "${inputPdfPath}" "${maskedPdfPath}" "${textDataPath}"`,
        {
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
          maxBuffer: 1024 * 1024 * 100,
        },
      );
    } catch (e: any) {
      const errLog = `Error: ${e?.message || String(e)}\nSTDOUT:\n${e?.stdout}\nSTDERR:\n${e?.stderr}\n`;
      try {
        fsSync.writeFileSync(path.join(__dirname, '..', 'error.log'), errLog);
      } catch (_err) {
        /* skip */
      }
      console.error('Text extraction failed:', e?.message || String(e));
      if (e?.stdout) console.error('STDOUT tail:', e.stdout.slice(-1000));
      if (e?.stderr) console.error('STDERR tail:', e.stderr.slice(-1000));
      await fs.copyFile(inputPdfPath, maskedPdfPath);
      await fs.writeFile(textDataPath, '[]');
    }

    console.log(`[job ${jobId}] Running Audiveris...`);
    const result = await runAudiveris({
      audiverisBin,
      outputBaseDir: outBase,
      inputPdfPath: maskedPdfPath,
    });

    const outputs = await collectMusicXmlOutputs(outBase);
    if (outputs.length === 0) {
      await fail({
        status: 422,
        error: 'Audiveris가 MusicXML/MXL을 만들지 못했습니다',
        exitCode: result.code,
        stdoutTail: tail(result.stdout),
        stderrTail: tail(result.stderr),
      });
      return;
    }

    console.log(`[job ${jobId}] Merging text into MusicXML...`);
    const mergerScript = path.join(__dirname, '..', 'scripts', 'mxl_text_merger.py');
    const mergedOutputs: string[] = [];
    for (const p of outputs) {
      const parsedPath = path.parse(p);
      const mergedP = path.join(parsedPath.dir, `${parsedPath.name}_merged${parsedPath.ext}`);
      try {
        await exec(`"${pythonCmd}" "${mergerScript}" "${p}" "${textDataPath}" "${mergedP}"`);
        mergedOutputs.push(mergedP);
      } catch (e) {
        console.error(`Merging failed for ${p}`, e);
        mergedOutputs.push(p);
      }
    }

    const finalOutputs = isDebug ? [...outputs, ...mergedOutputs] : mergedOutputs;
    const baseName = path.basename(originalName, path.extname(originalName)) || 'score';

    if (!isDebug && finalOutputs.length === 1) {
      const p = finalOutputs[0];
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
        finalOutputs,
        isDebug,
        maskedPdfPath,
        textDataPath,
        zipName,
      };
    }

    job.status = 'completed';
    job.finishedAt = Date.now();
    console.log(`[job ${jobId}] Completed`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await fail({ status: 500, error: '변환 중 오류', detail: msg });
    console.error(`[job ${jobId}]`, e);
  }
}

app.post('/api/convert', upload.single('pdf'), (req, res) => {
  const bin = resolveAudiverisBin();
  if (!bin) {
    res.status(503).json({
      error: 'AUDIVERIS_BIN is not set',
      detail:
        'Linux: export AUDIVERIS_BIN=/opt/audiveris/bin/Audiveris  |  Windows: Audiveris.bat 경로',
    });
    return;
  }

  const file = req.file;
  const isDebug = req.body.debug === 'true';

  if (!file) {
    res.status(400).json({ error: 'pdf 파일 필드가 필요합니다 (multipart field name: pdf)' });
    return;
  }

  const jobId = randomUUID();
  const sessionRoot = path.dirname(file.path);

  jobs.set(jobId, {
    status: 'pending',
    sessionRoot,
    originalName: file.originalname,
    inputPdfPath: file.path,
    isDebug,
    createdAt: Date.now(),
  });

  res.status(202).json({ jobId, message: '작업이 접수되었습니다' });

  void executeJob(jobId, bin);
});

app.get('/api/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: '알 수 없는 작업입니다' });
    return;
  }

  if (job.status === 'failed' && job.error) {
    const { status, ...body } = job.error;
    res.status(200).json({ status: job.status, httpError: status, ...body });
    return;
  }

  res.json({ status: job.status });
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

  if (result.isDebug) {
    if (fsSync.existsSync(result.maskedPdfPath)) {
      archive.file(result.maskedPdfPath, { name: path.basename(result.maskedPdfPath) });
    }
    if (fsSync.existsSync(result.textDataPath)) {
      archive.file(result.textDataPath, { name: path.basename(result.textDataPath) });
    }
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
