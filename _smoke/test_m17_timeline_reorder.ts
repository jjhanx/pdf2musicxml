/**
 * m17 PR: linkParallelOnsets 후 OSMD preview reorder — D5(t=0) before forward(v2).
 * Run: npx tsx _smoke/test_m17_timeline_reorder.ts
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview, reorderSingleStaffTimelineByOnsetForOsmdPreview } from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
});

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function pitch(n: Element): string {
  const step = n.querySelector('step, *|step')?.textContent ?? '?';
  const oct = n.querySelector('octave, *|octave')?.textContent ?? '?';
  const alter = n.querySelector('alter, *|alter')?.textContent ?? '';
  const acc = alter === '-1' ? 'b' : alter === '1' ? '#' : '';
  return `${step}${acc}${oct}`;
}

function firstTimelinePitches(measure: Element, limit = 6): string[] {
  const out: string[] = [];
  for (const c of [...measure.children]) {
    const tag = local(c);
    if (tag === 'forward') out.push('<<forward>>');
    else if (tag === 'backup') out.push('<<backup>>');
    else if (tag === 'note') out.push(pitch(c));
    if (out.length >= limit) break;
  }
  return out;
}

async function main() {
  if (!fs.existsSync('omr-work-0ea5ea52.zip')) {
    console.log('skip');
    return;
  }
  const rawXml = execSync('python _smoke/_export_m17_parallel_fix.py', {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  let xml = repairTimelineForOsmdPreview(rawXml);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const part = [...doc.querySelectorAll('part, *|part')].find((p) => p.getAttribute('id') === 'P5');
  const m17 = [...part!.children].find(
    (c) => local(c as Element) === 'measure' && (c as Element).getAttribute('number') === '17',
  ) as Element;

  for (const child of [...m17.children]) {
    if (local(child) === 'note') {
      const st = child.querySelector('staff, *|staff')?.textContent?.trim();
      if (st && st !== '1') child.remove();
    }
  }
  m17.querySelectorAll('note staff, note *|staff').forEach((el) => {
    el.textContent = '1';
  });
  pruneCrossStaffTimelineForOsmdPreview(m17, 1);

  const before = firstTimelinePitches(m17, 8);
  if (!before.includes('D5') || before.indexOf('D5') > before.indexOf('<<forward>>')) {
    console.log('pre-reorder (expected misorder):', before);
  }

  const changed = reorderSingleStaffTimelineByOnsetForOsmdPreview(m17);
  if (!changed) throw new Error('reorder should change m17 document order');

  const after = firstTimelinePitches(m17, 8);
  const d5 = after.indexOf('D5');
  const fwd = after.indexOf('<<forward>>');
  const f4 = after.indexOf('F4');
  const e5 = after.indexOf('E5');
  if (d5 < 0 || fwd < 0 || f4 < 0 || e5 < 0) throw new Error(`missing entries: ${after.join(',')}`);
  if (!(d5 < fwd && fwd < f4 && f4 < e5)) {
    throw new Error(`bad order after reorder: ${after.join(' | ')}`);
  }
  console.log('m17 timeline reorder ok', after.slice(0, 6).join(' → '));
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
