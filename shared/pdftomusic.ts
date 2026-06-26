/**
 * PDFtoMusic Pro CLI (p2mp) — 벡터 PDF → MusicXML/MXL
 * @see http://www.myriad-online.com/resources/docs/pdftomusicpro/english/command.htm
 *
 * 가사는 PDFtoMusic 기본 추출을 끄고(-lyrics 0) inject_ocr.py 로 검증된 가사를 주입합니다.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface PdfToMusicRunOptions {
  p2mpBin: string;
  inputPdfPath: string;
  outputDir: string;
  onStreamLine?: (stream: 'stdout' | 'stderr', line: string) => void;
}

export interface PdfToMusicRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

const DEFAULT_P2MP_PATHS: Record<string, string[]> = {
  win32: [
    'C:\\Program Files\\PDFtoMusic Pro\\p2mp.exe',
    'C:\\Program Files (x86)\\PDFtoMusic Pro\\p2mp.exe',
  ],
  linux: ['/usr/bin/p2mp', '/usr/local/bin/p2mp'],
  darwin: ['/Applications/p2mp', '/usr/local/bin/p2mp'],
};

export function resolveP2mpBin(): string | undefined {
  const fromEnv = process.env.P2MP_BIN?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const platform = process.platform as keyof typeof DEFAULT_P2MP_PATHS;
  const candidates = DEFAULT_P2MP_PATHS[platform] ?? DEFAULT_P2MP_PATHS.linux;
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

export function p2mpInstallHint(): string {
  return (
    'PDFtoMusic Pro를 설치하고 P2MP_BIN을 설정하세요 (예: Linux /usr/bin/p2mp, ' +
    'Windows "C:\\Program Files\\PDFtoMusic Pro\\p2mp.exe"). ' +
    '벡터 PDF(악보 편집기에서 내보낸 PDF) 전용입니다.'
  );
}

export function buildP2mpArgv(inputPdfPath: string, outputDir: string): string[] {
  const argv = [
    inputPdfPath,
    '-format',
    'MXL',
    '-pathdest',
    outputDir,
    '-lyrics',
    '0',
    '-multivoices',
    '1',
    '-tuplets',
    '1',
    '-dynamics',
    '1',
    '-tempi',
    '1',
  ];
  const reg = process.env.P2MP_REGISTER?.trim();
  if (reg) argv.push('-register', reg);
  return argv;
}

export async function runPdfToMusicPro(opts: PdfToMusicRunOptions): Promise<PdfToMusicRunResult> {
  await fs.promises.mkdir(opts.outputDir, { recursive: true });
  const argv = buildP2mpArgv(opts.inputPdfPath, opts.outputDir);

  return new Promise((resolve, reject) => {
    const child = spawn(opts.p2mpBin, argv, { windowsHide: true });
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
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** p2mp 출력 MXL/XML 수집 (outputDir 및 PDF와 같은 폴더). */
export async function collectPdfToMusicOutputs(
  outputDir: string,
  inputPdfPath: string,
): Promise<string[]> {
  const seen = new Set<string>();
  const out: string[] = [];
  const dirs = [outputDir, path.dirname(inputPdfPath)];
  const base = path.basename(inputPdfPath, path.extname(inputPdfPath)).toLowerCase();

  for (const dir of dirs) {
    let entries: string[] = [];
    try {
      entries = await fs.promises.readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const low = name.toLowerCase();
      if (!low.endsWith('.mxl') && !low.endsWith('.musicxml') && !low.endsWith('.xml')) continue;
      const full = path.join(dir, name);
      if (seen.has(full)) continue;
      seen.add(full);
      out.push(full);
    }
  }

  out.sort((a, b) => {
    const scoreName = (p: string) => path.basename(p).toLowerCase();
    const aBase = scoreName(a).replace(/\.(mxl|musicxml|xml)$/, '');
    const bBase = scoreName(b).replace(/\.(mxl|musicxml|xml)$/, '');
    if (aBase === base && bBase !== base) return -1;
    if (bBase === base && aBase !== base) return 1;
    if (a.endsWith('.mxl') && !b.endsWith('.mxl')) return -1;
    if (b.endsWith('.mxl') && !a.endsWith('.mxl')) return 1;
    return a.localeCompare(b);
  });
  return out;
}
