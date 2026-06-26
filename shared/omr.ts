/**
 * OMR engine dispatch — Audiveris(기본) | PDFtoMusic Pro(선택) | AI(실험).
 *
 * 환경 변수:
 *   OMR_ENGINE=audiveris | pdftomusic | ai  (기본 audiveris)
 *   AUDIVERIS_BIN — Audiveris 실행 파일 (기본 엔진)
 *   P2MP_BIN — PDFtoMusic Pro p2mp (OMR_ENGINE=pdftomusic, 개인용·상용 SaaS 비권장)
 *   AI_OMR_BACKEND=homr | tromr | mock  (OMR_ENGINE=ai 일 때만)
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { collectMusicXmlOutputs, resolveAudiverisBin, runAudiveris } from './audiveris.js';
import {
  collectPdfToMusicOutputs,
  p2mpInstallHint,
  resolveP2mpBin,
  runPdfToMusicPro,
} from './pdftomusic.js';

const __omrDir = path.dirname(fileURLToPath(import.meta.url));
const AI_OMR_SCRIPT = path.join(__omrDir, '..', 'scripts', 'run_ai_omr.py');

export type OmrEngineId = 'pdftomusic' | 'audiveris' | 'ai';

export interface OmrRunOptions {
  outputBaseDir: string;
  inputPdfPath: string;
  audiverisBin?: string;
  p2mpBin?: string;
  pythonBin?: string;
  extraArgs?: string[];
  onStreamLine?: (stream: 'stdout' | 'stderr', line: string) => void;
}

export interface OmrRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  engine: OmrEngineId;
  mxlPaths: string[];
}

export function resolveOmrEngine(): OmrEngineId {
  const raw = (process.env.OMR_ENGINE || 'audiveris').trim().toLowerCase();
  if (raw === 'pdftomusic') return 'pdftomusic';
  if (raw === 'ai') return 'ai';
  return 'audiveris';
}

export function omrEngineConfigured(): { engine: OmrEngineId; ready: boolean; detail?: string } {
  const engine = resolveOmrEngine();
  if (engine === 'pdftomusic') {
    const bin = resolveP2mpBin();
    return {
      engine,
      ready: Boolean(bin),
      detail: bin ? undefined : p2mpInstallHint(),
    };
  }
  if (engine === 'ai') {
    return { engine, ready: true, detail: `AI OMR backend=${process.env.AI_OMR_BACKEND || 'homr'}` };
  }
  const bin = resolveAudiverisBin();
  return {
    engine,
    ready: Boolean(bin),
    detail: bin ? undefined : 'Set AUDIVERIS_BIN (OMR_ENGINE=audiveris)',
  };
}

export async function runOmrEngine(opts: OmrRunOptions): Promise<OmrRunResult> {
  const engine = resolveOmrEngine();
  if (engine === 'pdftomusic') {
    return runPdfToMusicEngine(opts);
  }
  if (engine === 'ai') {
    return runAiOmrEngine(opts);
  }
  const bin = opts.audiverisBin ?? resolveAudiverisBin();
  if (!bin) {
    return {
      code: 1,
      stdout: '',
      stderr: 'AUDIVERIS_BIN is not set',
      engine: 'audiveris',
      mxlPaths: [],
    };
  }
  const result = await runAudiveris({
    audiverisBin: bin,
    outputBaseDir: opts.outputBaseDir,
    inputPdfPath: opts.inputPdfPath,
    extraArgs: opts.extraArgs,
    onStreamLine: opts.onStreamLine,
  });
  const mxlPaths = await collectMusicXmlOutputs(opts.outputBaseDir);
  return { ...result, engine: 'audiveris', mxlPaths };
}

async function runPdfToMusicEngine(opts: OmrRunOptions): Promise<OmrRunResult> {
  const p2mpBin = opts.p2mpBin ?? resolveP2mpBin();
  if (!p2mpBin) {
    return {
      code: 1,
      stdout: '',
      stderr: 'P2MP_BIN is not set and p2mp was not found',
      engine: 'pdftomusic',
      mxlPaths: [],
    };
  }

  await fs.mkdir(opts.outputBaseDir, { recursive: true });
  const result = await runPdfToMusicPro({
    p2mpBin,
    inputPdfPath: opts.inputPdfPath,
    outputDir: opts.outputBaseDir,
    onStreamLine: opts.onStreamLine,
  });

  let mxlPaths = await collectPdfToMusicOutputs(opts.outputBaseDir, opts.inputPdfPath);
  if (mxlPaths.length === 0) {
    mxlPaths = await collectMusicXmlOutputs(opts.outputBaseDir);
  }

  return {
    ...result,
    engine: 'pdftomusic',
    mxlPaths,
  };
}

async function runAiOmrEngine(opts: OmrRunOptions): Promise<OmrRunResult> {
  const pythonBin = opts.pythonBin || 'python';
  const scriptPath = AI_OMR_SCRIPT;

  await fs.mkdir(opts.outputBaseDir, { recursive: true });

  const argv = [scriptPath, opts.inputPdfPath, opts.outputBaseDir];
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, argv, {
      windowsHide: true,
      env: { ...process.env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => {
      const chunk = d.toString('utf8');
      stdout += chunk;
      for (const line of chunk.split(/\r?\n/)) {
        if (line.trim()) opts.onStreamLine?.('stdout', line);
      }
    });
    child.stderr?.on('data', (d: Buffer) => {
      const chunk = d.toString('utf8');
      stderr += chunk;
      for (const line of chunk.split(/\r?\n/)) {
        if (line.trim()) opts.onStreamLine?.('stderr', line);
      }
    });
    child.on('error', reject);
    child.on('close', async (code) => {
      let mxlPaths: string[] = [];
      try {
        const line = stdout.trim().split(/\r?\n/).pop() || '';
        const parsed = JSON.parse(line) as { mxlPaths?: string[]; error?: string };
        if (parsed.error) {
          stderr = `${stderr}\n${parsed.error}`.trim();
        }
        if (Array.isArray(parsed.mxlPaths)) {
          mxlPaths = parsed.mxlPaths;
        }
      } catch {
        mxlPaths = await collectMusicXmlOutputs(opts.outputBaseDir);
      }
      resolve({
        code,
        stdout,
        stderr,
        engine: 'ai',
        mxlPaths,
      });
    });
  });
}

export { collectMusicXmlOutputs, resolveP2mpBin, p2mpInstallHint };
