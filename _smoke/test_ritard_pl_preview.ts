/**
 * ritard. on PL (staff 2) must survive full-score split and PL filter preview.
 * Run: npx tsx _smoke/test_ritard_pl_preview.ts
 */
import fs from 'node:fs';
import { buildOsmdPreviewXml } from '../src/AudiverisInspectPanel.tsx';

const xml = fs.readFileSync('_smoke/_tmp_ritard_pl.xml', 'utf8');
const scoreParts = [
  { id: 'P1', suggestedLabel: 'S', displayLabel: 'S' },
  { id: 'P5', suggestedLabel: 'P', displayLabel: 'P' },
];

const full = buildOsmdPreviewXml(xml, scoreParts, null, { verbatim: true });
const pl = buildOsmdPreviewXml(xml, scoreParts, { label: 'PL', partId: 'P5', staffWithinPart: 2 }, {
  verbatim: true,
});
const pr = buildOsmdPreviewXml(xml, scoreParts, { label: 'PR', partId: 'P5', staffWithinPart: 1 }, {
  verbatim: true,
});

function wordsInPart(src: string, partId: string): string[] {
  const re = new RegExp(`<part id="${partId}"[\\s\\S]*?<\\/part>`);
  const block = src.match(re)?.[0] ?? '';
  return [...block.matchAll(/<words[^>]*>([^<]*)<\/words>/g)].map((m) => m[1].replace(/\u200B/g, ''));
}

const fullPl = wordsInPart(full, 'P5__PL');
const fullPr = wordsInPart(full, 'P5__PR');
const fullS = wordsInPart(full, 'P1');
const filterPl = wordsInPart(pl, 'P5');
const filterPr = wordsInPart(pr, 'P5');

console.log({ fullS, fullPr, fullPl, filterPr, filterPl });

let failed = false;
if (!fullS.some((w) => w.includes('ritard'))) {
  console.error('FAIL: S lost ritard in full preview');
  failed = true;
}
if (!fullPl.some((w) => w.includes('ritard'))) {
  console.error('FAIL: PL lost ritard in full-score split');
  failed = true;
}
if (!filterPl.some((w) => w.includes('ritard'))) {
  console.error('FAIL: PL filter lost ritard');
  failed = true;
}
if (fullPr.some((w) => w.includes('ritard'))) {
  console.error('FAIL: ritard leaked onto PR');
  failed = true;
}
if (failed) process.exit(1);
console.log('ritard pl preview ok');
