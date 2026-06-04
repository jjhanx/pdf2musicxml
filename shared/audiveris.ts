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

/** 공식 CLI `-help`에 나오는 시트 단계 순서 (일부 디버깅·문서와 동일한 이름). */
export const AUDIVERIS_SHEET_STEPS = [
  'LOAD',
  'BINARY',
  'SCALE',
  'GRID',
  'HEADERS',
  'STEM_SEEDS',
  'BEAMS',
  'LEDGERS',
  'HEADS',
  'STEMS',
  'REDUCTION',
  'CUE_BEAMS',
  'TEXTS',
  'MEASURES',
  'CHORDS',
  'CURVES',
  'SYMBOLS',
  'LINKS',
  'RHYTHMS',
  'PAGE',
] as const;

export type AudiverisSheetStepName = (typeof AUDIVERIS_SHEET_STEPS)[number];

export function isAudiverisSheetStep(s: string): s is AudiverisSheetStepName {
  return (AUDIVERIS_SHEET_STEPS as readonly string[]).includes(s);
}

/**
 * `-sheets` 인자용 토큰(공백 구분): `1`, `3`, `4-7` 등. `4-7`은 **하나의** 토큰이어야 함.
 * @throws Error 토큰이 형식에 맞지 않을 때
 */
export function parseAudiverisSheetsSpec(spec: string | undefined): string[] {
  if (!spec?.trim()) return [];
  const parts = spec.trim().split(/\s+/);
  for (const p of parts) {
    if (!/^\d+(?:-\d+)?$/.test(p)) {
      throw new Error(`잘못된 sheets 토큰: "${p}" (예: 1 또는 4-7)`);
    }
  }
  return parts;
}

/**
 * `-export` 없이 지정 단계까지 배치 실행 (`-save`로 중간 `.omr` 등 저장).
 * @see https://audiveris.github.io/audiveris/_pages/guides/advanced/cli/
 */
export function buildAudiverisStepProbeArgv(opts: {
  outputDir: string;
  inputPdfPath: string;
  step: string;
  force: boolean;
  sheetsTokens: string[];
}): string[] {
  const extra = defaultExtraArgsFromEnv();
  return [
    '-batch',
    '-output',
    opts.outputDir,
    '-save',
    ...(opts.force ? ['-force'] : []),
    ...(opts.sheetsTokens.length ? ['-sheets', ...opts.sheetsTokens] : []),
    '-step',
    opts.step,
    ...extra,
    '--',
    opts.inputPdfPath,
  ];
}

function buildArgs(opts: AudiverisRunOptions): string[] {
  const extra = opts.extraArgs ?? defaultExtraArgsFromEnv();
  return ['-batch', '-export', '-output', opts.outputBaseDir, ...extra, '--', opts.inputPdfPath];
}

/**
 * Audiveris에 넣을 OCR 언어 사양(health·로그 표시용).
 * - `AUDIVERIS_OCR_LANG` 미설정: `AUDIVERIS_CLEAN_SCORE_OCR_LANG` 또는 **`eng`**
 * - `AUDIVERIS_OCR_LANG=`(빈 문자열): `null` (CLI에 Language 상수 없음)
 */
export function resolvedAudiverisOcrLangSpec(): string | null {
  const raw = process.env.AUDIVERIS_OCR_LANG;
  if (raw === '') return null;
  const spec = (raw ?? process.env.AUDIVERIS_CLEAN_SCORE_OCR_LANG ?? 'eng').trim();
  return spec || null;
}

/**
 * Tesseract OCR 언어 사양 (예: eng, kor+eng).
 * - 미설정: `resolvedAudiverisOcrLangSpec()` → 기본 **`eng`**
 * - 빈 문자열 `AUDIVERIS_OCR_LANG=`: 상수를 넣지 않음 → Audiveris 기본
 * @see https://audiveris.github.io/audiveris/_pages/guides/main/languages/
 */
export function ocrLanguageConstantArgsFromEnv(): string[] {
  const spec = resolvedAudiverisOcrLangSpec();
  if (!spec) return [];
  return ['-constant', `org.audiveris.omr.text.Language.defaultSpecification=${spec}`];
}

/**
 * TEXTS 단계: OCR 단어가 SYMBOLS(세잇단 3 등) 글리프를 가로채지 않도록 Audiveris 상수 조정.
 * @see https://github.com/Audiveris/audiveris/issues/46
 */
export function audiverisTextEngineConstantArgsFromEnv(): string[] {
  if (
    process.env.AUDIVERIS_KEEP_TEXT_CONSTANTS === '1' ||
    process.env.AUDIVERIS_KEEP_TEXT_CONSTANTS === 'true'
  ) {
    return [];
  }
  return [
    '-constant',
    'org.audiveris.omr.text.TextWord.constants.abnormalWordRegexp=^[<>{}\\[\\]PpRrLl9]+$',
    '-constant',
    String.raw`org.audiveris.omr.text.TextWord.constants.tupletWordRegexp=^(?:[36]|[36][\-_\u2014]+|[\-_\u2014]*[36][\-_\u2014]*)$`,
  ];
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

/**
 * 가사·제목은 inject_ocr로 넣고 Audiveris는 악보만 인식할 때 쓰는 처리 스위치.
 * `AUDIVERIS_KEEP_DEFAULT_SWITCHES=1` 이면 비활성.
 */
export function audiverisCleanScoreConstantArgsFromEnv(): string[] {
  const keep =
    process.env.AUDIVERIS_KEEP_DEFAULT_SWITCHES === '1' ||
    process.env.AUDIVERIS_KEEP_DEFAULT_SWITCHES === 'true';
  if (keep) return [];
  return [
    '-constant',
    'org.audiveris.omr.sheet.ProcessingSwitches.constants.lyrics=false',
    '-constant',
    'org.audiveris.omr.sheet.ProcessingSwitches.constants.lyricsAboveStaff=false',
    '-constant',
    'org.audiveris.omr.sheet.ProcessingSwitches.constants.chordNames=false',
    '-constant',
    'org.audiveris.omr.sheet.ProcessingSwitches.constants.pluckings=false',
    '-constant',
    'org.audiveris.omr.sheet.ProcessingSwitches.constants.fingerings=false',
    '-constant',
    'org.audiveris.omr.sheet.ProcessingSwitches.constants.disconnectedBracedParts=true',
    ...audiverisTextEngineConstantArgsFromEnv(),
  ];
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
  return [
    ...ocrLanguageConstantArgsFromEnv(),
    ...flat,
    ...audiverisCleanScoreConstantArgsFromEnv(),
    ...audiverisExtraCliArgsFromEnv(),
  ];
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

function utf8Tail(buf: Buffer, maxBytes: number): string {
  if (buf.length <= maxBytes) return buf.toString('utf8');
  const slice = buf.subarray(buf.length - maxBytes);
  return `…[stdout/stderr 앞부분 생략, 마지막 ${maxBytes}바이트]\n${slice.toString('utf8')}`;
}

/** 임의 Audiveris CLI 인자 배열 실행 (`runAudiveris`의 저수준 버전). */
export function runAudiverisArgv(options: {
  audiverisBin: string;
  argv: string[];
  onStreamLine?: (stream: 'stdout' | 'stderr', line: string) => void;
  /** 비스트리밍 시 각 스트림 최대 보존 바이트 (미지정이면 전체 유지 — 긴 로그에 주의). */
  maxCaptureBytesPerStream?: number;
}): Promise<AudiverisRunResult> {
  const bin = options.audiverisBin;
  const shell = path.extname(bin).toLowerCase() === '.bat';
  const argv = options.argv;
  const maxCap = options.maxCaptureBytesPerStream;

  return new Promise((resolve, reject) => {
    const child = spawn(bin, argv, { shell, windowsHide: true, env: envForAudiverisSpawn() });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const onLine = options.onStreamLine;
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
      const outBuf = Buffer.concat(stdoutChunks);
      const errBuf = Buffer.concat(stderrChunks);
      resolve({
        code,
        stdout: onLine
          ? streamedText
          : maxCap != null
            ? utf8Tail(outBuf, maxCap)
            : outBuf.toString('utf8'),
        stderr: onLine
          ? streamedText
          : maxCap != null
            ? utf8Tail(errBuf, maxCap)
            : errBuf.toString('utf8'),
      });
    });
  });
}

export function runAudiveris(opts: AudiverisRunOptions): Promise<AudiverisRunResult> {
  return runAudiverisArgv({
    audiverisBin: opts.audiverisBin,
    argv: buildArgs(opts),
    onStreamLine: opts.onStreamLine,
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
