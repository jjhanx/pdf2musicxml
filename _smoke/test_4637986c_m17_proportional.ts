/**
 * omr-work-4637986c m17 PR: orig-x proportional spacing — F5 within quarter, G4 at measure end.
 * Run: npx tsx _smoke/test_4637986c_m17_proportional.ts
 */
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
import { defaultXFromOnset } from '../shared/musicXmlPreviewOnsetLayout';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, { document: dom.window.document, DOMParser: dom.window.DOMParser });

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
const pitch = (n: Element) => {
  const step = n.querySelector('step,*|step')?.textContent ?? '';
  const oct = n.querySelector('octave,*|octave')?.textContent ?? '';
  return `${step}${oct}`;
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
  const raw = execSync('python _smoke/_export_4637986c_review.py', { encoding: 'utf8', maxBuffer: 30e6 });
  const m17 = buildM17(raw);

  const e5 = [...m17.children].find(
    (c) => local(c) === 'note' && pitch(c as Element) === 'E5' && !(c as Element).querySelector('chord,*|chord'),
  ) as Element;
  const f5 = [...m17.children].find(
    (c) => local(c) === 'note' && pitch(c as Element) === 'F5' && !(c as Element).querySelector('chord,*|chord'),
  ) as Element;
  const g4 = [...m17.children].find(
    (c) => local(c) === 'note' && pitch(c as Element) === 'G4' && !(c as Element).querySelector('chord,*|chord'),
  ) as Element;
  if (!e5 || !f5 || !g4) throw new Error('E5/F5/G4 missing');

  const quarterSpan = parseFloat(defaultXFromOnset(2, 4)) - parseFloat(defaultXFromOnset(0, 4));
  const beamEighth = dx(f5) - dx(e5);
  if (beamEighth >= quarterSpan) {
    throw new Error(`F5 must be within quarter beat of E5 got beam8th=${beamEighth} quarter=${quarterSpan}`);
  }
  const endX = parseFloat(defaultXFromOnset(4, 4));
  if (Math.abs(dx(g4) - endX) > 1) {
    throw new Error(`G4 should span to measure end got ${dx(g4)} expected ${endX}`);
  }
  if (dx(f5) >= dx(g4)) {
    throw new Error(`F5 must precede trailing quarter G4 got F5=${dx(f5)} G4=${dx(g4)}`);
  }

  console.log('OK 4637986c m17 proportional', { e5x: dx(e5), f5x: dx(f5), g4x: dx(g4), beamEighth, endX });
}

main();
