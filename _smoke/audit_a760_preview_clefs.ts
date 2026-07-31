/**
 * a760 m32–33 phantom clef audit (preview sanitization + PL split).
 * Run: npx tsx _smoke/audit_a760_preview_clefs.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  buildOsmdPreviewXml,
  repairKeyChangeClefMisreadForOsmd,
  removeRedundantCourtesyClefsForOsmd,
} from '../src/AudiverisInspectPanel.tsx';

const zipPath = path.resolve('omr-work-a760c5c1.zip');
if (!fs.existsSync(zipPath)) {
  console.error('missing', zipPath);
  process.exit(1);
}
const tmpDir = path.resolve('_smoke/_a760_ts');
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

function attrsDump(partId: string, mNum: string, xml: string, label: string) {
  const partRe = new RegExp(`<part id="${partId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[\\s\\S]*?</part>`);
  const part = xml.match(partRe)?.[0] ?? '';
  const mRe = new RegExp(`<measure number="${mNum}"[\\s\\S]*?</measure>`);
  const m = part.match(mRe)?.[0] ?? '';
  const attrs = [...m.matchAll(/<attributes[\s\S]*?<\/attributes>/g)].map((x) =>
    x[0].replace(/\s+/g, ' ').slice(0, 220),
  );
  console.log(`${label} ${partId} m${mNum}: ${attrs.length ? attrs.join(' | ') : '(no attrs)'}`);
}

let sanitized = repairKeyChangeClefMisreadForOsmd(raw);
sanitized = removeRedundantCourtesyClefsForOsmd(sanitized);

const pl = buildOsmdPreviewXml(
  sanitized,
  scoreParts,
  { label: 'PL', partId: 'P4', staffWithinPart: 2 },
  { verbatim: true },
);

let fail = 0;
for (const [pid, m, xml, label] of [
  ['P1', '33', sanitized, 'SATB sanitize'],
  ['P1', '34', sanitized, 'SATB sanitize'],
  ['P4', '33', sanitized, 'Piano sanitize'],
  ['P4', '34', sanitized, 'Piano sanitize'],
  ['P4', '32', pl, 'PL split'],
  ['P4', '33', pl, 'PL split'],
] as const) {
  attrsDump(pid, m, xml, label);
  const partRe = new RegExp(`<part id="${pid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[\\s\\S]*?</part>`);
  const part = xml.match(partRe)?.[0] ?? '';
  const mRe = new RegExp(`<measure number="${m}"[\\s\\S]*?</measure>`);
  const meas = part.match(mRe)?.[0] ?? '';
  if (/<clef[\s\S]*?<sign>F<\/sign>/.test(meas) && label.includes('m33') && pid === 'P4' && label.includes('sanitize')) {
    console.error('FAIL: P4 m33 still has F clef after sanitize');
    fail += 1;
  }
  if (/<clef[\s\S]*?<sign>G<\/sign>/.test(meas) && m === '34' && pid !== 'P4') {
    console.error(`FAIL: ${pid} m34 still has courtesy G clef`);
    fail += 1;
  }
  if (/<clef/.test(meas) && label === 'PL split' && (m === '32' || m === '33')) {
    console.error(`FAIL: PL m${m} has clef in split view`);
    fail += 1;
  }
}

console.log(fail ? `\n${fail} check(s) failed` : '\nOK');
process.exit(fail ? 1 : 0);
