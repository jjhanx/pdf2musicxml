/**
 * HITL 미리보기 rest display-step 정리 검증.
 * Run: npx tsx _smoke/test_rest_display_osmd_preview.ts
 */
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { repairRestDisplayForOsmdPreview } from '../shared/musicXmlRestDisplay';

const dom = new JSDOM('');
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;

function countMeasureRestDisplayD(xml: string): number {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  let n = 0;
  for (const rest of doc.querySelectorAll('rest[measure="yes"]')) {
    const step = rest.querySelector(':scope > display-step, :scope > *|display-step')?.textContent?.trim().toUpperCase();
    if (step === 'D') n += 1;
  }
  return n;
}

function countRestDisplayHints(xml: string): number {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return doc.querySelectorAll('display-step, *|display-step').length;
}

const xmlPath = '_smoke/_6cbf_final/audiveris_raw/clean_score_only.xml';
if (!fs.existsSync(xmlPath)) {
  console.error('missing', xmlPath);
  process.exit(2);
}

const raw = fs.readFileSync(xmlPath, 'utf8');
const fixed = repairRestDisplayForOsmdPreview(raw);

const beforeD = countMeasureRestDisplayD(raw);
const afterD = countMeasureRestDisplayD(fixed);
const beforeHints = countRestDisplayHints(raw);
const afterHints = countRestDisplayHints(fixed);

console.log('measure rest display-step D:', beforeD, '->', afterD);
console.log('all rest display-step count:', beforeHints, '->', afterHints);

if (beforeD === 0) {
  console.error('fixture has no measure rest display-step D — pick another sample');
  process.exit(2);
}
if (afterD !== 0) {
  console.error('expected no measure=yes rests with display-step D after repair');
  process.exit(1);
}
if (afterHints >= beforeHints) {
  console.error('expected fewer display-step hints after repair');
  process.exit(1);
}

console.log('ok');
