/**
 * PR staff filter must keep leading <forward> so parallel-onset F4 aligns with E5.
 * Run: npx tsx _smoke/test_prune_leading_forward.ts
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
(globalThis as unknown as { window: Window }).window = dom.window as unknown as Window;
(globalThis as unknown as { document: Document }).document = dom.window.document;
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = dom.window.DOMParser;
(globalThis as unknown as { XMLSerializer: typeof XMLSerializer }).XMLSerializer = dom.window.XMLSerializer;

if (!fs.existsSync('omr-work-0ea5ea52.zip')) {
  console.log('skip: zip not found');
  process.exit(0);
}

let xml = execSync('python _smoke/_export_m17_parallel_fix.py', {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
});
xml = repairTimelineForOsmdPreview(xml);

const doc = new DOMParser().parseFromString(xml, 'text/xml');
const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
const part = [...doc.querySelectorAll('part, *|part')].find((p) => p.getAttribute('id') === 'P5')!;
const measure = [...part.children].find(
  (c) => local(c as Element) === 'measure' && (c as Element).getAttribute('number') === '17',
)! as Element;

// PR filter steps (verbatim): keep staff 1 notes only, staff tag -> 1, prune, repair again
for (const child of [...measure.children]) {
  if (local(child) === 'note' && child.querySelector('staff, *|staff')?.textContent?.trim() !== '1') {
    child.remove();
  }
}
measure.querySelectorAll('note staff, note *|staff').forEach((el) => {
  el.textContent = '1';
});
pruneCrossStaffTimelineForOsmdPreview(measure, 1);

const forwards = [...measure.children].filter((c) => local(c as Element) === 'forward');
if (forwards.length === 0) {
  throw new Error('leading forward removed by pruneCrossStaffTimeline');
}

const xml2 = repairTimelineForOsmdPreview(new XMLSerializer().serializeToString(doc));
const doc2 = new DOMParser().parseFromString(xml2, 'text/xml');
const part2 = [...doc2.querySelectorAll('part, *|part')].find((p) => p.getAttribute('id') === 'P5')!;
const m2 = [...part2.children].find(
  (c) => local(c as Element) === 'measure' && (c as Element).getAttribute('number') === '17',
)! as Element;

const xs: Record<string, string> = {};
for (const child of [...m2.children]) {
  if (local(child) !== 'note') continue;
  const n = child as Element;
  const step = n.querySelector('step, *|step')?.textContent ?? '?';
  const oct = n.querySelector('octave, *|octave')?.textContent ?? '?';
  const alter = n.querySelector('alter, *|alter')?.textContent ?? '';
  const acc = alter === '-1' ? 'b' : '';
  const pitch = `${step}${acc}${oct}`;
  if (pitch === 'F4' && !xs.F4) xs.F4 = n.getAttribute('default-x') ?? '';
  if (pitch === 'E5' && !xs.E5) xs.E5 = n.getAttribute('default-x') ?? '';
}
if (xs.F4 !== xs.E5) throw new Error(`after PR prune pipeline F4 x=${xs.F4} E5 x=${xs.E5}`);
console.log('prune leading forward ok', xs.F4);
