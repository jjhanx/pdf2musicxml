/**
 * Audiveris CLI wrapper — 공식 문서: https://audiveris.github.io/audiveris/_pages/guides/advanced/cli/
 *
 * 기본 호출 형태:
 *   Audiveris -batch -export -output <baseOutputDir> -- <input.pdf>
 */

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface AudiverisRunOptions {
  audiverisBin: string;
  outputBaseDir: string;
  inputPdfPath: string;
  /** 추가 인자 (예: -option 키=값) */
  extraArgs?: string[];
}

export interface AudiverisRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function buildArgs(opts: AudiverisRunOptions): string[] {
  const extra = opts.extraArgs ?? defaultExtraArgsFromEnv();
  return ['-batch', '-export', '-output', opts.outputBaseDir, ...extra, '--', opts.inputPdfPath];
}

/** 단일 폴더에 .mxl 모으기 (여러 악보 책 폴더 방지) — 필요 시 환경변수로 끔 */
export function defaultExtraArgsFromEnv(): string[] {
  if (process.env.AUDIVERIS_NO_FLAT_OUTPUT === '1' || process.env.AUDIVERIS_NO_FLAT_OUTPUT === 'true') {
    return [];
  }
  return [
    '-option',
    'org.audiveris.omr.sheet.BookManager.useSeparateBookFolders=false',
  ];
}

export function resolveAudiverisBin(): string | undefined {
  const v = process.env.AUDIVERIS_BIN?.trim();
  return v || undefined;
}

export function runAudiveris(opts: AudiverisRunOptions): Promise<AudiverisRunResult> {
  const args = buildArgs(opts);
  const bin = opts.audiverisBin;
  const shell = path.extname(bin).toLowerCase() === '.bat';

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { shell, windowsHide: true });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on('data', (d: Buffer) => stdoutChunks.push(d));
    child.stderr?.on('data', (d: Buffer) => stderrChunks.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      });
    });
  });
}

const MUSIC_EXT = /\.(mxl|musicxml)$/i;

async function walkFiles(dir: string, acc: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      await walkFiles(full, acc);
    } else if (MUSIC_EXT.test(ent.name)) {
      acc.push(full);
    }
  }
}

/** Audiveris 실행 후 생성된 MusicXML / MXL 파일 경로들 */
export async function collectMusicXmlOutputs(searchRoot: string): Promise<string[]> {
  const acc: string[] = [];
  await walkFiles(searchRoot, acc);
  acc.sort();
  return acc;
}

export function defaultDownloadsDir(): string {
  const home = process.env.USERPROFILE || process.env.HOME || process.cwd();
  return path.join(home, 'Downloads');
}
