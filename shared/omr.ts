/**
 * OMR engine dispatch — AI OMR(기본) | Audiveris(레거시).
 *
 * 환경 변수:
 *   OMR_ENGINE=ai | audiveris  (기본 ai)
 *   AI_OMR_BACKEND=tromr(기본) | mock(개발용)
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { collectMusicXmlOutputs, resolveAudiverisBin, runAudiveris } from './audiveris.js';

const __omrDir = path.dirname(fileURLToPath(import.meta.url));
const AI_OMR_SCRIPT = path.join(__omrDir, '..', 'scripts', 'run_ai_omr.py');

export type OmrEngineId = 'audiveris' | 'ai';

export interface OmrRunOptions {
  outputBaseDir: string;
  inputPdfPath: string;
  audiverisBin?: string;
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
  const raw = (process.env.OMR_ENGINE || 'ai').trim().toLowerCase();
  if (raw === 'audiveris') return 'audiveris';
  return 'ai';
}

export function omrEngineConfigured(): { engine: OmrEngineId; ready: boolean; detail?: string } {
  const engine = resolveOmrEngine();
  if (engine === 'ai') {
    return { engine, ready: true, detail: `AI OMR backend=${process.env.AI_OMR_BACKEND || 'tromr'}` };
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

export { collectMusicXmlOutputs };
