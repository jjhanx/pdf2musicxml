/**
 * m17: onset-proportional default-x — beamed 8th step < quarter step; trailing spread.
 * Run: npx tsx _smoke/test_m17_proportional_layout.ts
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
import {
  dedupeSamePlayOrderPitchLayersForOsmdPreview,
  HITL_PLAY_ORDER_ATTR,
} from '../shared/musicXmlPlayOrder';
import {
  collectStaffNoteOnsets,
  defaultXFromOnset,
  measureTimelineEndUnits,
  measureLengthUnits,
} from '../shared/musicXmlPreviewOnsetLayout';

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
  dedupeSamePlayOrderPitchLayersForOsmdPreview(m17);
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
  const raw = execSync('python _smoke/_export_m17_play_order2.py', { encoding: 'utf8', maxBuffer: 20e6 });
  const m17 = buildM17(raw);
  const onsets = collectStaffNoteOnsets(m17, 1);

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
  if (dx(f4) !== dx(e5)) throw new Error(`parallel po=2 must share x F4=${dx(f4)} E5=${dx(e5)}`);

  const layoutOnsetF5 = parseInt(f5.getAttribute('data-osmd-onset-units') ?? '-1', 10);
  const e5Raw = onsets.get(e5) ?? 0;
  const f5Raw = onsets.get(f5) ?? 0;
  if (layoutOnsetF5 !== e5Raw - e5Raw + (f5Raw - e5Raw)) {
    // layout = group anchor 0 + delta from E5
    if (layoutOnsetF5 !== f5Raw - e5Raw) {
      throw new Error(`F5 layout onset should be voice delta from E5 got ${layoutOnsetF5} expected ${f5Raw - e5Raw}`);
    }
  }

  const eighthSpan = dx(f5) - dx(f4);
  const quarterSpan = parseFloat(defaultXFromOnset(2, 4)) - parseFloat(defaultXFromOnset(0, 4));
  if (eighthSpan >= quarterSpan) {
    throw new Error(`beamed 8th step should be < quarter step got 8th=${eighthSpan} quarter=${quarterSpan}`);
  }
  if (Math.abs(eighthSpan - (parseFloat(defaultXFromOnset(1, 4)) - 32)) > 0.05) {
    throw new Error(`F5 should be one eighth-step from F4 column got span=${eighthSpan}`);
  }

  console.log('OK m17 proportional layout', {
    f4x: dx(f4),
    e5x: dx(e5),
    f5x: dx(f5),
    layoutOnsetF5,
    eighthSpan,
    quarterSpan,
  });
}

main();
