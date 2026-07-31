/**
 * Compare raw vs buildOsmdPreviewXml (verbatim) for omr-work-6cbf1add m4/m32/m33.
 * Run: npx tsx _smoke/test_6cbf_preview_m4_m32.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  buildOsmdPreviewXml,
  repairKeyChangeClefMisreadForOsmd,
  removeRedundantCourtesyClefsForOsmd,
} from '../src/AudiverisInspectPanel.tsx';

const zipPath = path.resolve('너에게 난 나에게 넌/omr-work-6cbf1add.zip');
const tmpDir = path.resolve('_smoke/_6cbf_tmp');
fs.mkdirSync(tmpDir, { recursive: true });
execSync(
  `powershell -NoProfile -Command "Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${tmpDir}'"`,
  { stdio: 'inherit' },
);

const rawMxl = path.join(tmpDir, 'review.mxl');
execSync(
  `powershell -NoProfile -Command "Expand-Archive -Force -Path '${rawMxl}' -DestinationPath '${tmpDir}/mxl'"`,
  { stdio: 'inherit' },
);
const xmlFiles = fs
  .readdirSync(path.join(tmpDir, 'mxl'))
  .filter((f) => f.endsWith('.xml') && !f.toUpperCase().includes('META'));
const raw = fs.readFileSync(path.join(tmpDir, 'mxl', xmlFiles[0]!), 'utf8');

const manifest = JSON.parse(fs.readFileSync(path.join(tmpDir, 'manifest.json'), 'utf8'));
const scoreParts = manifest.scoreParts as Array<{ id: string; displayLabel?: string; suggestedLabel?: string }>;

function measureDump(partId: string, mNum: string, xml: string, label: string) {
  const partRe = new RegExp(`<part id="${partId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[\\s\\S]*?</part>`);
  const part = xml.match(partRe)?.[0] ?? '';
  const mRe = new RegExp(`<measure number="${mNum}"[\\s\\S]*?</measure>`);
  const m = part.match(mRe)?.[0] ?? '';
  console.log(`\n=== ${label} ${partId} m${mNum} ===`);
  if (!m) {
    console.log('  (missing)');
    return;
  }
  const attr = m.match(/<attributes[\s\S]*?<\/attributes>/)?.[0];
  if (attr) console.log('  ATTR:', attr.replace(/\s+/g, ' ').slice(0, 200));
  let t = 0;
  for (const chunk of m.split(/(?=<)/)) {
    if (chunk.startsWith('<backup')) {
      const d = Number(chunk.match(/<duration>(\d+)<\/duration>/)?.[1] ?? 0);
      t -= d;
      console.log(`  backup dur=${d} t=${t}`);
    } else if (chunk.startsWith('<forward')) {
      const d = Number(chunk.match(/<duration>(\d+)<\/duration>/)?.[1] ?? 0);
      t += d;
      console.log(`  forward dur=${d} t=${t}`);
    } else if (chunk.startsWith('<note')) {
      const rest = chunk.includes('<rest');
      const chord = chunk.includes('<chord');
      const dur = Number(chunk.match(/<duration>(\d+)<\/duration>/)?.[1] ?? 0);
      const step = chunk.match(/<step>([^<]+)<\/step>/)?.[1] ?? '';
      const oct = chunk.match(/<octave>(\d+)<\/octave>/)?.[1] ?? '';
      const typ = chunk.match(/<type>([^<]+)<\/type>/)?.[1] ?? '';
      console.log(
        `  ${rest ? 'rest' : 'note'} ${rest ? typ : step + oct} dur=${dur} t=${t}${chord ? ' CHORD' : ''}`,
      );
      if (!chord) t += dur;
    }
  }
  console.log(`  final t=${t}`);
}

const fullVerbatim = buildOsmdPreviewXml(raw, scoreParts, null, { verbatim: true });
const prFilter = buildOsmdPreviewXml(raw, scoreParts, { label: 'PR', partId: 'P5', staffWithinPart: 1 }, { verbatim: true });
const plFilter = buildOsmdPreviewXml(raw, scoreParts, { label: 'PL', partId: 'P5', staffWithinPart: 2 }, { verbatim: true });

// Find piano part id from manifest
const piano = scoreParts.find((p) => /P|piano/i.test(p.displayLabel ?? p.suggestedLabel ?? '')) ?? scoreParts[scoreParts.length - 1]!;
const pianoId = piano.id;
console.log('Piano part:', pianoId, piano.displayLabel ?? piano.suggestedLabel);

for (const m of ['4', '32', '33']) {
  measureDump(pianoId, m, raw, 'RAW');
  measureDump(`${pianoId}__PR`, m, fullVerbatim, 'SPLIT verbatim');
  measureDump(`${pianoId}__PL`, m, fullVerbatim, 'SPLIT verbatim');
}

measureDump('P5__PR', '4', fullVerbatim, 'full');
measureDump('P5__PL', '4', fullVerbatim, 'full');

// Non-verbatim split for m4 comparison
const fullNonVerbatim = buildOsmdPreviewXml(raw, scoreParts, null, { verbatim: false });
measureDump(`${pianoId}__PR`, '4', fullNonVerbatim, 'SPLIT non-verbatim');
measureDump(`${pianoId}__PL`, '4', fullNonVerbatim, 'SPLIT non-verbatim');

// Sanitize effect on m32/m33 for SATB
for (const pid of ['P1', 'P2', 'P3', 'P4']) {
  measureDump(pid, '32', raw, 'RAW');
  let s = repairKeyChangeClefMisreadForOsmd(raw);
  s = removeRedundantCourtesyClefsForOsmd(s);
  measureDump(pid, '32', s, 'after repair+courtesy');
  measureDump(pid, '33', raw, 'RAW m33');
  measureDump(pid, '33', s, 'after repair m33');
}
