import archiver from 'archiver';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  collectMusicXmlOutputs,
  resolveAudiverisBin,
  runAudiveris,
} from '../shared/audiveris.js';

const PORT = Number(process.env.PORT || 8787);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');

const app = express();
app.use(cors({ origin: true }));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'pdf2mxl-up-'));
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const safe = path.basename(file.originalname).replace(/[^\w.\-\uAC00-\uD7A3]+/g, '_');
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
  if (!file) {
    res.status(400).json({ error: 'pdf 파일 필드가 필요합니다 (multipart field name: pdf)' });
    return;
  }

  const sessionRoot = path.dirname(file.path);
  const outBase = path.join(sessionRoot, 'audiveris-out');

  const wipeSession = () => fs.rm(sessionRoot, { recursive: true, force: true }).catch(() => {});

  try {
    await fs.mkdir(outBase, { recursive: true });

    const result = await runAudiveris({
      audiverisBin: bin,
      outputBaseDir: outBase,
      inputPdfPath: file.path,
    });

    const outputs = await collectMusicXmlOutputs(outBase);
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

    const baseName = path.basename(file.originalname, path.extname(file.originalname)) || 'score';

    if (outputs.length === 1) {
      const p = outputs[0];
      res.setHeader('Content-Type', 'application/octet-stream');
      const asciiName = `${baseName}${path.extname(p)}`.replace(/[^\x20-\x7E]/g, '_');
      res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"`);
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
    const zipAscii = `${baseName}-parts.zip`.replace(/[^\x20-\x7E]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${zipAscii}"`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', async (err: Error) => {
      await wipeSession();
      if (!res.headersSent) res.status(500).end(String(err));
    });
    archive.pipe(res);
    for (const p of outputs) {
      archive.file(p, { name: path.basename(p) });
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
  app.use(express.static(distDir));
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
app.listen(PORT, host, () => {
  const ui = fsSync.existsSync(distDir) ? ' + UI' : '';
  // eslint-disable-next-line no-console
  console.log(`pdf2mxl listening on http://${host}:${PORT} (API${ui})`);
});
