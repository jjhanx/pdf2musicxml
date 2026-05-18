/**
 * Audiveris CLI wrapper — 공식 문서: https://audiveris.github.io/audiveris/_pages/guides/advanced/cli/
 *
 * 기본 호출 형태:
 *   Audiveris -batch -export -output <baseOutputDir> [-constant org.audiveris.omr.text.Language.defaultSpecification=kor+eng] ... -- <input.pdf>
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
  /** 배치 로그 한 줄씩(개행 단위). 긴 작업 진행 표시용 */
  onStreamLine?: (stream: 'stdout' | 'stderr', line: string) => void;
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

/**
 * Tesseract OCR 언어 사양 (예: kor+eng).
 * - 미설정: 기본 `kor+eng` (한글 가사·제목 + 라틴 기호 병행 악보에 맞춤)
 * - 빈 문자열 `AUDIVERIS_OCR_LANG=`: 상수를 넣지 않음 → Audiveris 기본(보통 eng만)
 * @see https://audiveris.github.io/audiveris/_pages/guides/main/languages/
 */
export function ocrLanguageConstantArgsFromEnv(): string[] {
  const raw = process.env.AUDIVERIS_OCR_LANG;
  if (raw === '') return [];
  const spec = (raw ?? 'kor+eng').trim();
  if (!spec) return [];
  return ['-constant', `org.audiveris.omr.text.Language.defaultSpecification=${spec}`];
}

/**
 * Audiveris CLI에 추가로 붙일 토큰 목록. `AUDIVERIS_CLI_EXTRA_JSON` 환경 변수(JSON 문자 배열)를 파싱합니다.
 * 예: `["-constant","org.audiveris.omr.sheet.Scale.defaultBeamSpecification=10"]`
 * @see https://audiveris.github.io/audiveris/_pages/guides/advanced/cli/
 */
export function audiverisExtraCliArgsFromEnv(): string[] {
  const raw = process.env.AUDIVERIS_CLI_EXTRA_JSON?.trim();
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.map((x) => String(x));
  } catch {
    return [];
  }
}

/** 단일 폴더에 .mxl 모으기 (여러 악보 책 폴더 방지) — 필요 시 환경변수로 끔 */
export function defaultExtraArgsFromEnv(): string[] {
  const flat =
    process.env.AUDIVERIS_NO_FLAT_OUTPUT === '1' || process.env.AUDIVERIS_NO_FLAT_OUTPUT === 'true'
      ? []
      : [
          '-option',
          'org.audiveris.omr.sheet.BookManager.useSeparateBookFolders=false',
        ];
  return [...ocrLanguageConstantArgsFromEnv(), ...flat, ...audiverisExtraCliArgsFromEnv()];
}

export function resolveAudiverisBin(): string | undefined {
  const v = process.env.AUDIVERIS_BIN?.trim();
  return v || undefined;
}

function attachLineReader(
  stream: NodeJS.ReadableStream | null | undefined,
  onLine: (line: string) => void,
): { flush: () => void } {
  if (!stream) {
    return { flush: () => {} };
  }
  let buf = '';
  stream?.on('data', (d: Buffer) => {
    buf += d.toString('utf8');
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i + 1);
      onLine(raw.endsWith('\r') ? raw.slice(0, -1) : raw);
    }
  });
  return {
    flush: () => {
      if (buf.length) {
        onLine(buf.endsWith('\r') ? buf.slice(0, -1) : buf);
        buf = '';
      }
    },
  };
}

/** Linux 서버 등 화면 없는 환경에서 Audiveris가 AWT/X11로 폰트를 열려다 실패하지 않도록 JVM에 headless를 넣습니다. */
export function envForAudiverisSpawn(): NodeJS.ProcessEnv {
  const headless = '-Djava.awt.headless=true';
  const next = { ...process.env };
  const cur = next.JAVA_TOOL_OPTIONS?.trim();
  if (!cur) {
    next.JAVA_TOOL_OPTIONS = headless;
  } else if (!/\bjava\.awt\.headless=/.test(cur)) {
    next.JAVA_TOOL_OPTIONS = `${cur} ${headless}`;
  }
  return next;
}

export function runAudiveris(opts: AudiverisRunOptions): Promise<AudiverisRunResult> {
  const args = buildArgs(opts);
  const bin = opts.audiverisBin;
  const shell = path.extname(bin).toLowerCase() === '.bat';

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { shell, windowsHide: true, env: envForAudiverisSpawn() });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const onLine = opts.onStreamLine;
    const streamedLines: string[] = [];

    const recordLine = (stream: 'stdout' | 'stderr', line: string) => {
      streamedLines.push(`[${stream}] ${line}`);
      if (streamedLines.length > 400) streamedLines.splice(0, streamedLines.length - 300);
    };

    let outFlush: { flush: () => void } | undefined;
    let errFlush: { flush: () => void } | undefined;

    if (onLine) {
      outFlush = attachLineReader(child.stdout!, (line) => {
        if (line.length) {
          recordLine('stdout', line);
          onLine('stdout', line);
        }
      });
      errFlush = attachLineReader(child.stderr!, (line) => {
        if (line.length) {
          recordLine('stderr', line);
          onLine('stderr', line);
        }
      });
    } else {
      child.stdout?.on('data', (d: Buffer) => stdoutChunks.push(d));
      child.stderr?.on('data', (d: Buffer) => stderrChunks.push(d));
    }
    child.on('error', reject);
    child.on('close', (code) => {
      if (onLine) {
        outFlush?.flush();
        errFlush?.flush();
      }
      const streamedText = streamedLines.join('\n');
      resolve({
        code,
        stdout: onLine ? streamedText : Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: onLine ? streamedText : Buffer.concat(stderrChunks).toString('utf8'),
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

export function audiverisLogSuggestsHumanReview(stdout: string, stderr: string): boolean {
  const v = process.env.AUDIVERIS_PAUSE_ON_WARN?.trim().toLowerCase();
  if (v !== '1' && v !== 'true' && v !== 'yes') return false;
  const blob = `${String(stdout ?? '')}\n${String(stderr ?? '')}`;
  const custom = process.env.AUDIVERIS_WARN_PATTERN?.trim();
  if (custom) {
    try {
      return new RegExp(custom, 'm').test(blob);
    } catch {
      return /\bWARN\b/i.test(blob);
    }
  }
  return /\bWARN\b/i.test(blob);
}
