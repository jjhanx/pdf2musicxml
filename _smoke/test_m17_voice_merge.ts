/**
 * m17 PR: linkParallelOnsets — XML keeps eighth+beam; no chord merge.
 * Run: npx tsx _smoke/test_m17_voice_merge.ts
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import {
  repairTimelineForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
  collectLinkedParallelOnsetHintsFromMeasure,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
});

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function transformM17(measure: Element): void {
  for (const child of [...measure.children]) {
    if (local(child) === 'note') {
      const st = child.querySelector('staff, *|staff')?.textContent?.trim();
      if (st && st !== '1') child.remove();
    }
  }
  measure.querySelectorAll('note staff, note *|staff').forEach((el) => {
    el.textContent = '1';
  });
  pruneCrossStaffTimelineForOsmdPreview(measure, 1);
  snapshotNoteDefaultXForOsmdPreview(measure);
  reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
  normalizeMultiVoiceLayersForOsmdPreview(measure);
  realignMeasureDefaultXFromTimelineForOsmd(measure);
}

function pitch(n: Element): string {
  const step = n.querySelector('step, *|step')?.textContent ?? '?';
  const oct = n.querySelector('octave, *|octave')?.textContent ?? '?';
  const alter = n.querySelector('alter, *|alter')?.textContent ?? '';
  const acc = alter === '-1' ? 'b' : '';
  return `${step}${acc}${oct}`;
}

async function main() {
  if (!fs.existsSync('omr-work-0ea5ea52.zip')) {
    console.log('skip');
    return;
  }
  const raw = execSync('python _smoke/_export_m17_parallel_fix.py', { encoding: 'utf8', maxBuffer: 20e6 });
  let xml = repairTimelineForOsmdPreview(raw);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const part = [...doc.querySelectorAll('part, *|part')].find((p) => p.getAttribute('id') === 'P5')!;
  const m17 = [...part.children].find(
    (c) => local(c as Element) === 'measure' && (c as Element).getAttribute('number') === '17',
  ) as Element;
  transformM17(m17);

  const hints = collectLinkedParallelOnsetHintsFromMeasure('P5', m17, 2, 8);
  if (!hints.length) throw new Error('expected linked parallel hint for m17');

  const notes = [...m17.children].filter((c) => local(c) === 'note') as Element[];
  const e5 = notes.find((n) => pitch(n) === 'E5');
  const f4 = notes.find((n) => pitch(n) === 'F4' && !n.querySelector('chord, *|chord'));
  if (!e5 || !f4) throw new Error('missing notes');

  if (e5.querySelector('type, *|type')?.textContent !== 'eighth') throw new Error('E5 type must stay eighth');
  if (e5.querySelector('chord, *|chord') !== null) throw new Error('E5 must not become chord');
  if (e5.querySelector('beam, *|beam')?.textContent !== 'begin') throw new Error('E5 beam begin missing');

  const f5 = notes.find((n) => pitch(n) === 'F5');
  if (f5?.querySelector('type,*|type')?.textContent !== 'eighth') throw new Error('F5 not eighth');
  if (f5?.querySelector('beam,*|beam')?.textContent !== 'end') throw new Error('F5 beam end missing');

  console.log('m17 no-merge xml ok — eighth+beam preserved, hints=', hints);
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
