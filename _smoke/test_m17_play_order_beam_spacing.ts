/**
 * m17 PR: po1(quarter) → po2(E5) → po3(F5 beamed) — E5–F5 span ≈ half of po1–po2 span.
 * Run: npx tsx _smoke/test_m17_play_order_beam_spacing.ts
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import {
  repairTimelineForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
import { unifyVoiceForSamePlayOrderPreview } from '../shared/musicXmlPlayOrder';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, { document: dom.window.document, DOMParser: dom.window.DOMParser });

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
const pitch = (n: Element) => {
  const step = n.querySelector('step,*|step')?.textContent ?? '';
  const oct = n.querySelector('octave,*|octave')?.textContent ?? '';
  const alter = n.querySelector('alter,*|alter')?.textContent ?? '';
  return `${step}${alter === '-1' ? 'b' : ''}${oct}`;
};

function buildM17(raw: string): Element {
  let xml = repairTimelineForOsmdPreview(raw);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
  const m17 = [...part.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === '17') as Element;
  for (const child of [...m17.children]) {
    if (local(child) === 'note') {
      const st = child.querySelector('staff,*|staff')?.textContent?.trim();
      if (st && st !== '1') child.remove();
    }
  }
  m17.querySelectorAll('note staff,note *|staff').forEach((el) => { el.textContent = '1'; });
  pruneCrossStaffTimelineForOsmdPreview(m17, 1);
  snapshotNoteDefaultXForOsmdPreview(m17);
  reorderSingleStaffTimelineByOnsetForOsmdPreview(m17);
  normalizeMultiVoiceLayersForOsmdPreview(m17);
  unifyVoiceForSamePlayOrderPreview(m17);
  realignMeasureDefaultXFromTimelineForOsmd(m17);
  return m17;
}

function dx(note: Element): number {
  return parseFloat(note.getAttribute('default-x') ?? '0');
}

function main() {
  if (!fs.existsSync('omr-work-0ea5ea52.zip')) {
    console.log('skip');
    return;
  }
  const raw = execSync('python _smoke/_export_m17_play_order123.py', { encoding: 'utf8', maxBuffer: 20e6 });
  const m17 = buildM17(raw);

  const f4 = [...m17.children].find(
    (c) => local(c) === 'note' && pitch(c as Element) === 'F4' && !(c as Element).querySelector('chord,*|chord'),
  ) as Element;
  const e5 = [...m17.children].find(
    (c) => local(c) === 'note' && pitch(c as Element) === 'E5' && !(c as Element).querySelector('chord,*|chord'),
  ) as Element;
  const f5 = [...m17.children].find(
    (c) => local(c) === 'note' && pitch(c as Element) === 'F5' && !(c as Element).querySelector('chord,*|chord'),
  ) as Element;
  if (!f4 || !e5 || !f5) throw new Error('F4/E5/F5 missing');

  const po1ToPo2 = dx(e5) - dx(f4);
  const po2ToPo3 = dx(f5) - dx(e5);
  if (po1ToPo2 <= 0) {
    throw new Error(`po1 F4 should be left of po2 E5 got F4=${dx(f4)} E5=${dx(e5)}`);
  }
  const ratio = po2ToPo3 / po1ToPo2;
  if (Math.abs(ratio - 0.5) > 0.08) {
    throw new Error(
      `E5–F5 should be ~half of F4–E5 spacing got ratio=${ratio.toFixed(3)} ` +
        `(po1→po2=${po1ToPo2} po2→po3=${po2ToPo3})`,
    );
  }

  console.log('OK m17 play-order beam spacing', {
    f4x: dx(f4),
    e5x: dx(e5),
    f5x: dx(f5),
    po1ToPo2,
    po2ToPo3,
    ratio,
  });
}

main();
