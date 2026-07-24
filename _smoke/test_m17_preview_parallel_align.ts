/**
 * m17 PR: linkParallelOnsets 후 OSMD preview에서 F4/Bb4/E5 default-x 정렬.
 * Run: npx tsx _smoke/test_m17_preview_parallel_align.ts
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
(globalThis as unknown as { window: Window }).window = dom.window as unknown as Window;
(globalThis as unknown as { document: Document }).document = dom.window.document;
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = dom.window.DOMParser;
(globalThis as unknown as { XMLSerializer: typeof XMLSerializer }).XMLSerializer = dom.window.XMLSerializer;

const zip = 'omr-work-0ea5ea52.zip';
if (!fs.existsSync(zip)) {
  console.log('skip: zip not found');
  process.exit(0);
}

const rawXml = execSync('python _smoke/_export_m17_parallel_fix.py', {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
  cwd: process.cwd(),
});
const preview = repairTimelineForOsmdPreview(rawXml);

const doc = new DOMParser().parseFromString(preview, 'text/xml');
const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
const part = [...doc.querySelectorAll('part, *|part')].find((p) => p.getAttribute('id') === 'P5');
if (!part) throw new Error('P5 missing');
const measure = [...part.children].find(
  (c) => local(c as Element) === 'measure' && (c as Element).getAttribute('number') === '17',
);
if (!measure) throw new Error('m17 missing');

type NoteInfo = { pitch: string; x: string };
const notes: NoteInfo[] = [];
for (const child of [...measure!.children]) {
  if (local(child as Element) !== 'note') continue;
  const n = child as Element;
  const step = n.querySelector('step, *|step')?.textContent ?? '?';
  const oct = n.querySelector('octave, *|octave')?.textContent ?? '?';
  const alter = n.querySelector('alter, *|alter')?.textContent ?? '';
  const acc = alter === '-1' ? 'b' : alter === '1' ? '#' : '';
  notes.push({ pitch: `${step}${acc}${oct}`, x: n.getAttribute('default-x') ?? '' });
}

const f4 = notes.find((n) => n.pitch === 'F4' && !notes.slice(0, notes.indexOf(n)).some((p) => p.pitch.startsWith('F4')));
const e5 = notes.find((n) => n.pitch === 'E5');
const firstF4 = notes.filter((n) => n.pitch === 'F4')[0];
const firstE5 = notes.filter((n) => n.pitch === 'E5')[0];
if (!firstF4 || !firstE5) throw new Error(`notes missing: ${JSON.stringify(notes.slice(0, 6))}`);
if (!firstF4.x || !firstE5.x) throw new Error('preview must have timeline default-x');
if (firstF4.x !== firstE5.x) {
  throw new Error(`F4 x=${firstF4.x} != E5 x=${firstE5.x}`);
}
console.log('m17 preview parallel align ok', firstF4.x, notes.slice(0, 5));
