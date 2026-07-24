/** m17 after layer normalization — voice1 block before backup before voice2. */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import {
  repairTimelineForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
});
const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function pitch(n: Element): string {
  const step = n.querySelector('step, *|step')?.textContent ?? '?';
  const oct = n.querySelector('octave, *|octave')?.textContent ?? '?';
  return step + oct;
}

function timelineLabels(measure: Element, limit = 10): string[] {
  const out: string[] = [];
  for (const c of [...measure.children]) {
    const tag = local(c);
    if (tag === 'note') out.push(`${pitch(c)}(v${c.querySelector('voice,*|voice')?.textContent})`);
    else if (tag === 'forward' || tag === 'backup') out.push(`<<${tag}>>`);
    if (out.length >= limit) break;
  }
  return out;
}

async function main() {
  if (!fs.existsSync('omr-work-0ea5ea52.zip')) { console.log('skip'); return; }
  const raw = execSync('python _smoke/_export_m17_parallel_fix.py', { encoding: 'utf8', maxBuffer: 20e6 });
  const doc = new DOMParser().parseFromString(repairTimelineForOsmdPreview(raw), 'text/xml');
  const part = [...doc.querySelectorAll('part, *|part')].find((p) => p.getAttribute('id') === 'P5')!;
  const m17 = [...part.children].find((c) => local(c as Element) === 'measure' && (c as Element).getAttribute('number') === '17') as Element;
  for (const child of [...m17.children]) {
    if (local(child) === 'note') {
      const st = child.querySelector('staff, *|staff')?.textContent?.trim();
      if (st && st !== '1') child.remove();
    }
  }
  pruneCrossStaffTimelineForOsmdPreview(m17, 1);
  reorderSingleStaffTimelineByOnsetForOsmdPreview(m17);
  if (!normalizeMultiVoiceLayersForOsmdPreview(m17)) throw new Error('layer norm should run');
  const labels = timelineLabels(m17, 12);
  console.log(labels.join(' → '));
  const e5 = labels.indexOf('E5(v1)');
  const backup = labels.indexOf('<<backup>>');
  const f4 = labels.indexOf('F4(v2)');
  if (!(e5 >= 0 && backup > e5 && f4 > backup)) {
    throw new Error(`bad layer order: ${labels.join(' | ')}`);
  }
  console.log('m17 layer norm ok');
}

main().catch((e) => { console.error('FAIL', e); process.exit(1); });
