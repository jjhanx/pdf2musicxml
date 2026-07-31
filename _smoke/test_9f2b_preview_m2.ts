/**
 * Check PL/PR rhythmic timeline after buildOsmdPreviewXml for omr-work-9f2b6020 m2.
 * Run: npx tsx _smoke/test_9f2b_preview_m2.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { buildOsmdPreviewXml } from '../src/AudiverisInspectPanel.tsx';

const zipPath = path.resolve('omr-work-9f2b6020.zip');
const tmpDir = path.resolve('_smoke/_9f2b_tmp');
fs.mkdirSync(tmpDir, { recursive: true });
execSync(`powershell -NoProfile -Command "Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${tmpDir}'"`, {
  stdio: 'inherit',
});

const rawMxl = path.join(tmpDir, 'audiveris_raw.mxl');
execSync(`powershell -NoProfile -Command "Expand-Archive -Force -Path '${rawMxl}' -DestinationPath '${tmpDir}/mxl'"`, {
  stdio: 'inherit',
});
const xmlFiles = fs.readdirSync(path.join(tmpDir, 'mxl')).filter((f) => f.endsWith('.xml') && !f.toUpperCase().includes('META'));
const raw = fs.readFileSync(path.join(tmpDir, 'mxl', xmlFiles[0]!), 'utf8');

const scoreParts = [
  { id: 'P1', suggestedLabel: 'P1', displayLabel: 'P1' },
  { id: 'P2', suggestedLabel: 'P2', displayLabel: 'P2' },
  { id: 'P3', suggestedLabel: 'P3', displayLabel: 'P3' },
  { id: 'P4', suggestedLabel: 'P', displayLabel: 'P' },
];

function timeline(partId: string, mNum: string, xml: string) {
  const partRe = new RegExp(`<part id="${partId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[\\s\\S]*?</part>`);
  const part = xml.match(partRe)?.[0] ?? '';
  const mRe = new RegExp(`<measure number="${mNum}"[\\s\\S]*?</measure>`);
  const m = part.match(mRe)?.[0] ?? '';
  let t = 0;
  let idx = 0;
  const rows: string[] = [];
  for (const chunk of m.split(/(?=<)/)) {
    if (chunk.startsWith('<backup')) {
      const d = chunk.match(/<duration>(\d+)<\/duration>/)?.[1];
      t -= Number(d ?? 0);
      rows.push(`  backup dur=${d} t->${t}`);
    } else if (chunk.startsWith('<forward')) {
      const d = chunk.match(/<duration>(\d+)<\/duration>/)?.[1];
      t += Number(d ?? 0);
      rows.push(`  forward dur=${d} t->${t}`);
    } else if (chunk.startsWith('<note')) {
      idx += 1;
      const chord = chunk.includes('<chord');
      const dur = chunk.match(/<duration>(\d+)<\/duration>/)?.[1] ?? '?';
      const step = chunk.match(/<step>([^<]+)<\/step>/)?.[1] ?? 'rest';
      const oct = chunk.match(/<octave>(\d+)<\/octave>/)?.[1] ?? '';
      const dx = chunk.match(/default-x="([^"]+)"/)?.[1] ?? '';
      rows.push(`  #${idx} t=${t} dur=${dur} dx=${dx} ${step}${oct}${chord ? ' CHORD' : ''}`);
      if (!chord) t += Number(dur);
    }
  }
  return rows;
}

const full = buildOsmdPreviewXml(raw, scoreParts, null);
const plOnly = buildOsmdPreviewXml(raw, scoreParts, { label: 'PL', partId: 'P4', staffWithinPart: 2 });

console.log('=== P4__PR m2 (full split) ===');
timeline('P4__PR', '2', full).forEach((l) => console.log(l));
console.log('\n=== P4__PL m2 (full split) ===');
timeline('P4__PL', '2', full).forEach((l) => console.log(l));
console.log('\n=== P4 PL filter m2 ===');
timeline('P4', '2', plOnly).forEach((l) => console.log(l));
