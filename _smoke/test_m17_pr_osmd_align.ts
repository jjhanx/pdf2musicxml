/**
 * m17 PR linkParallelOnsets: F4·Bb4·E5 must share default-x after preview transform.
 * Run: npx tsx _smoke/test_m17_pr_osmd_align.ts
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
Object.assign(globalThis, { document: dom.window.document, DOMParser: dom.window.DOMParser, XMLSerializer: dom.window.XMLSerializer });

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function buildPrPreview(raw: string): string {
  let xml = repairTimelineForOsmdPreview(raw);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
  for (const measure of [...part.children]) {
    if (local(measure) !== 'measure') continue;
    for (const child of [...measure.children]) {
      if (local(child) === 'note') {
        const st = child.querySelector('staff,*|staff')?.textContent?.trim();
        if (st && st !== '1') child.remove();
      }
    }
    measure.querySelectorAll('note staff,note *|staff').forEach((el) => { el.textContent = '1'; });
    pruneCrossStaffTimelineForOsmdPreview(measure, 1);
    reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
    normalizeMultiVoiceLayersForOsmdPreview(measure);
    mergeSameOnsetVoicesForOsmdPreview(measure);
    realignMeasureDefaultXFromTimelineForOsmd(measure);
  }
  return repairTimelineForOsmdPreview(new XMLSerializer().serializeToString(doc));
}

function pitch(n: Element): string {
  const step = n.querySelector('step,*|step')?.textContent ?? '';
  const oct = n.querySelector('octave,*|octave')?.textContent ?? '';
  const alter = n.querySelector('alter,*|alter')?.textContent ?? '';
  return `${step}${alter === '-1' ? 'b' : ''}${oct}`;
}

async function main() {
  if (!fs.existsSync('omr-work-0ea5ea52.zip')) { console.log('skip'); return; }
  const raw = execSync('python _smoke/_export_m17_parallel_fix.py', { encoding: 'utf8', maxBuffer: 20e6 });
  const preview = buildPrPreview(raw);
  const doc = new DOMParser().parseFromString(preview, 'text/xml');
  const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
  const m17 = [...part.children].find((c) => local(c as Element) === 'measure' && (c as Element).getAttribute('number') === '17') as Element;
  const notes = [...m17.children].filter((c) => local(c) === 'note') as Element[];

  const f4 = notes.find((n) => pitch(n) === 'F4' && n.querySelector('voice,*|voice')?.textContent === '2');
  const bb = notes.find((n) => pitch(n) === 'Bb4' && f4 && Math.abs([...m17.children].indexOf(n) - [...m17.children].indexOf(f4)) <= 2);
  const e5 = notes.find((n) => pitch(n) === 'E5' && n.querySelector('beam,*|beam')?.textContent === 'begin');
  if (!f4 || !bb || !e5) throw new Error('parallel group notes missing');

  const xs = new Set([f4.getAttribute('default-x'), bb.getAttribute('default-x'), e5.getAttribute('default-x')]);
  if (xs.size !== 1 || !xs.values().next().value) {
    throw new Error(`F4/Bb4/E5 default-x differ: ${[...xs].join(', ')}`);
  }

  console.log('m17 PR parallel same-x ok', xs.values().next().value);
}

main().catch((e) => { console.error('FAIL', e); process.exit(1); });
