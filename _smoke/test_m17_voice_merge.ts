/**
 * m17 PR: mergeSameOnsetVoicesForOsmdPreview — F4 leader + E5/Bb4 chord (same column, beam kept).
 * Run: npx tsx _smoke/test_m17_voice_merge.ts
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import {
  repairTimelineForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  mergeSameOnsetVoicesForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
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
  reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
  normalizeMultiVoiceLayersForOsmdPreview(measure);
  mergeSameOnsetVoicesForOsmdPreview(measure);
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

  const notes = [...m17.children].filter((c) => local(c) === 'note') as Element[];
  const e5 = notes.find((n) => pitch(n) === 'E5');
  const f4 = notes.find((n) => pitch(n) === 'F4');
  const bb = notes.find((n) => pitch(n) === 'Bb4');
  if (!e5 || !f4 || !bb) throw new Error('missing notes');

  const e5v = e5.querySelector('voice, *|voice')?.textContent;
  const f4v = f4.querySelector('voice, *|voice')?.textContent;
  if (e5v !== f4v) throw new Error(`voice mismatch E5=${e5v} F4=${f4v}`);
  if (f4.querySelector('chord, *|chord') !== null) throw new Error('F4 must be leader (no chord)');
  if (e5.querySelector('chord, *|chord') === null) throw new Error('E5 must be chord under F4');
  if (bb.querySelector('chord, *|chord') === null) throw new Error('Bb4 must be chord');

  const order = notes.slice(0, 6).map((n) => `${pitch(n)}${n.querySelector('chord,*|chord') ? '*' : ''}`);
  if (order[0] !== 'D5' || order[1] !== 'F4' || order[2] !== 'E5*' || order[3] !== 'Bb4*') {
    throw new Error(`unexpected order: ${order.join(', ')}`);
  }

  const e5Beam = e5.querySelector('beam, *|beam')?.textContent;
  const f5 = notes.find((n) => pitch(n) === 'F5');
  const f5Beam = f5?.querySelector('beam, *|beam')?.textContent;
  if (e5Beam !== 'begin' || f5Beam !== 'end') {
    throw new Error(`beam broken: E5=${e5Beam} F5=${f5Beam}`);
  }

  console.log('m17 voice merge ok', order.slice(0, 5).join(' → '));
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
