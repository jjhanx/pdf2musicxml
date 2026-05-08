import archiver from 'archiver';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
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
  });
});

app.post('/api/convert', upload.single('pdf'), async (req, res) => {
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

  const sessionRoot = path.dirname(file.path);
  const outBase = path.join(sessionRoot, 'audiveris-out');

  const wipeSession = () => fs.rm(sessionRoot, { recursive: true, force: true }).catch(() => {});

  try {
    await fs.mkdir(outBase, { recursive: true });

    // Step 1: Extract Text & Mask PDF
    const maskedPdfPath = path.join(sessionRoot, 'masked_input.pdf');
    const textDataPath = path.join(sessionRoot, 'text_data.json');
    const extractorScript = path.join(__dirname, '..', 'scripts', 'pdf_text_extractor.py');
    
    console.log('Running text extraction...');
    try {
      await exec(`"${pythonCmd}" "${extractorScript}" "${file.path}" "${maskedPdfPath}" "${textDataPath}"`, {
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        maxBuffer: 1024 * 1024 * 100 // 100MB buffer for easyocr model download logs
      });
    } catch (e: any) {
      const errLog = `Error: ${e?.message || String(e)}\nSTDOUT:\n${e?.stdout}\nSTDERR:\n${e?.stderr}\n`;
      try { fsSync.writeFileSync(path.join(__dirname, '..', 'error.log'), errLog); } catch (err) {}
      console.error('Text extraction failed:', e?.message || String(e));
      if (e?.stdout) console.error('STDOUT tail:', e.stdout.slice(-1000));
      if (e?.stderr) console.error('STDERR tail:', e.stderr.slice(-1000));
      // Fallback: use original file if python script fails
      await fs.copyFile(file.path, maskedPdfPath);
      await fs.writeFile(textDataPath, '[]');
    }

    // Step 2: Run Audiveris on Masked PDF
    console.log('Running Audiveris...');
    const result = await runAudiveris({
      audiverisBin: bin,
      outputBaseDir: outBase,
      inputPdfPath: maskedPdfPath,
    });

    let outputs = await collectMusicXmlOutputs(outBase);
    if (outputs.length === 0) {
      await wipeSession();
      res.status(422).json({
        error: 'Audiveris가 MusicXML/MXL을 만들지 못했습니다',
        exitCode: result.code,
        stdoutTail: tail(result.stdout),
        stderrTail: tail(result.stderr),
      });
      return;
    }

    // Step 3: Merge Text back into MusicXML
    console.log('Merging text into MusicXML...');
    const mergerScript = path.join(__dirname, '..', 'scripts', 'mxl_text_merger.py');
    const mergedOutputs = [];
    for (const p of outputs) {
      const parsedPath = path.parse(p);
      const mergedP = path.join(parsedPath.dir, `${parsedPath.name}_merged${parsedPath.ext}`);
      try {
        await exec(`"${pythonCmd}" "${mergerScript}" "${p}" "${textDataPath}" "${mergedP}"`);
        mergedOutputs.push(mergedP);
      } catch (e) {
        console.error(`Merging failed for ${p}`, e);
        mergedOutputs.push(p); // Fallback to unmerged
      }
    }

    const finalOutputs = isDebug ? [...outputs, ...mergedOutputs] : mergedOutputs;

    const baseName = path.basename(file.originalname, path.extname(file.originalname)) || 'score';

    if (!isDebug && finalOutputs.length === 1) {
      const p = finalOutputs[0];
      res.setHeader('Content-Type', 'application/octet-stream');
      const asciiName = `${baseName}${path.extname(p)}`.replace(/[^\x20-\x7E]/g, '_');
      const encodedName = encodeURIComponent(`${baseName}${path.extname(p)}`);
      res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`);
      const rs = fsSync.createReadStream(p);
      rs.on('error', async () => {
        await wipeSession();
      });
      res.once('finish', wipeSession);
      res.once('close', wipeSession);
      rs.pipe(res);
      return;
    }

    res.setHeader('Content-Type', 'application/zip');
    const zipName = isDebug ? `${baseName}-debug.zip` : `${baseName}-parts.zip`;
    const zipAscii = zipName.replace(/[^\x20-\x7E]/g, '_');
    const zipEncoded = encodeURIComponent(zipName);
    res.setHeader('Content-Disposition', `attachment; filename="${zipAscii}"; filename*=UTF-8''${zipEncoded}`);
    
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', async (err: Error) => {
      await wipeSession();
      if (!res.headersSent) res.status(500).end(String(err));
    });
    archive.pipe(res);

    if (isDebug) {
      if (fsSync.existsSync(maskedPdfPath)) {
        archive.file(maskedPdfPath, { name: path.basename(maskedPdfPath) });
      }
      if (fsSync.existsSync(textDataPath)) {
        archive.file(textDataPath, { name: path.basename(textDataPath) });
      }
    }

    const addedFiles = new Set<string>();
    for (const p of finalOutputs) {
      if (!addedFiles.has(p)) {
        archive.file(p, { name: path.basename(p) });
        addedFiles.add(p);
      }
    }
    
    await archive.finalize();
    res.once('finish', wipeSession);
    res.once('close', wipeSession);
  } catch (e) {
    await wipeSession();
    const msg = e instanceof Error ? e.message : String(e);
    if (!res.headersSent) {
      res.status(500).json({ error: '변환 중 오류', detail: msg });
    }
  }
});
function tail(s: string, max = 8000): string {
  if (s.length <= max) return s;
  return s.slice(-max);
}

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
});
server.setTimeout(30 * 60 * 1000); // 30 minutes timeout for long OCR/Audiveris tasks
