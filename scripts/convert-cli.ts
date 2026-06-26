#!/usr/bin/env node
/**
 * CLI: PDF → MusicXML/MXL (Audiveris 기본)
 *
 * 사용 예:
 *   npm run convert -- "D:\scores\piece.pdf"
 *
 * 출력은 기본적으로 사용자 Downloads 폴더에 저장합니다 (-o 로 변경 가능).
 */

import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  collectMusicXmlOutputs,
  defaultDownloadsDir,
  resolveAudiverisBin,
} from '../shared/audiveris.js';
import { resolveOmrEngine, resolveP2mpBin, runOmrEngine } from '../shared/omr.js';

function usage(): never {
  // eslint-disable-next-line no-console
  console.error(`Usage:
  npm run convert -- <input.pdf> [-o <outputFileOrDirectory>]

Environment:
  OMR_ENGINE      audiveris(기본) | pdftomusic (선택) | ai (실험)
  AUDIVERIS_BIN   OMR_ENGINE=audiveris 일 때 필수
  P2MP_BIN        OMR_ENGINE=pdftomusic 일 때
`);
  process.exit(1);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  if (argv.length === 0) usage();

  let outArg: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--output') {
      outArg = argv[i + 1];
      i++;
    } else if (!a.startsWith('-')) {
      positional.push(a);
    }
  }

  const pdfPath = path.resolve(positional[0] ?? '');
  if (!pdfPath || !fsSync.existsSync(pdfPath)) {
    // eslint-disable-next-line no-console
    console.error(`PDF not found: ${pdfPath}`);
    process.exit(2);
  }

  const engine = resolveOmrEngine();
  const bin = resolveAudiverisBin();
  const p2mpBin = resolveP2mpBin();
  if (engine === 'audiveris' && !bin) {
    // eslint-disable-next-line no-console
    console.error('AUDIVERIS_BIN 환경 변수를 설정하세요 (OMR_ENGINE=audiveris).');
    process.exit(3);
  }
  if (engine === 'pdftomusic' && !p2mpBin) {
    // eslint-disable-next-line no-console
    console.error('P2MP_BIN을 설정하거나 PDFtoMusic Pro를 설치하세요 (OMR_ENGINE=pdftomusic).');
    process.exit(3);
  }

  const sessionRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf2mxl-cli-'));
  const outBase = path.join(sessionRoot, 'out');
  const stem = path.basename(pdfPath, path.extname(pdfPath));

  try {
    await fs.mkdir(outBase, { recursive: true });
    const result = await runOmrEngine({
      audiverisBin: bin,
      p2mpBin,
      outputBaseDir: outBase,
      inputPdfPath: pdfPath,
    });

    const outputs =
      result.mxlPaths.length > 0 ? result.mxlPaths : await collectMusicXmlOutputs(outBase);
    if (outputs.length === 0) {
      // eslint-disable-next-line no-console
      console.error(`${engine} OMR finished but no .mxl/.musicxml was found.`);
      // eslint-disable-next-line no-console
      console.error('exit:', result.code);
      // eslint-disable-next-line no-console
      console.error(result.stderr || result.stdout);
      process.exit(4);
    }

    if (outputs.length === 1) {
      const src = outputs[0];
      const ext = path.extname(src);
      let dest: string;
      if (!outArg) {
        dest = path.join(defaultDownloadsDir(), `${stem}_${engine}${ext}`);
      } else {
        const resolved = path.resolve(outArg);
        if (/\.(mxl|musicxml)$/i.test(resolved)) {
          dest = resolved;
        } else {
          await fs.mkdir(resolved, { recursive: true });
          dest = path.join(resolved, `${stem}${ext}`);
        }
      }
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(src, dest);
      // eslint-disable-next-line no-console
      console.log('Saved:', dest);
    } else {
      const dir = outArg
        ? path.resolve(outArg)
        : path.join(defaultDownloadsDir(), `${stem}_omr_parts`);
      await fs.mkdir(dir, { recursive: true });
      for (const src of outputs) {
        await fs.copyFile(src, path.join(dir, path.basename(src)));
      }
      // eslint-disable-next-line no-console
      console.log(`Saved ${outputs.length} files under:`, dir);
    }

    if (result.code !== 0) {
      // eslint-disable-next-line no-console
      console.warn(`${engine} OMR exited with code`, result.code, '(파일은 생성되었을 수 있음)');
    }
  } finally {
    await fs.rm(sessionRoot, { recursive: true, force: true });
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(99);
});
