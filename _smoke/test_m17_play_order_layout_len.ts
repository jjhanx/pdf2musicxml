/**
 * m17 po 2/3/4: layoutLen must use timeline end when <divisions> missing —
 * else po4+trailing crush at 432 (vanish) and po3–po4 gap stays huge.
 * Run: npx tsx _smoke/test_m17_play_order_layout_len.ts
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
import { applyPlayOrderLayoutToMeasure, measureLengthUnitsExport } from '../shared/musicXmlPlayOrder';
import { measureTimelineEndUnits } from '../shared/musicXmlPreviewOnsetLayout';

const dom = new JSDOM('');
Object.assign(globalThis, {
  DOMParser: dom.window.DOMParser,
  Node: dom.window.Node,
});

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
const pitch = (n: Element) => {
  const step = n.querySelector('step,*|step')?.textContent ?? '';
  const oct = n.querySelector('octave,*|octave')?.textContent ?? '';
  const alter = n.querySelector('alter,*|alter')?.textContent ?? '';
  return `${step}${alter === '-1' ? 'b' : ''}${oct}`;
};
const dx = (n: Element) => parseFloat(n.getAttribute('default-x') ?? '0');

function main() {
  if (!fs.existsSync('omr-work-0ea5ea52.zip')) {
    console.log('skip');
    return;
  }
  const raw = execSync('python _smoke/_export_m17_play_order_234.py', {
    encoding: 'utf8',
    maxBuffer: 30e6,
  });
  let xml = repairTimelineForOsmdPreview(raw);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
  const m17 = [...part.children].find(
    (c) => local(c) === 'measure' && c.getAttribute('number') === '17',
  ) as Element;
  for (const child of [...m17.children]) {
    if (local(child) === 'note') {
      const st = child.querySelector('staff,*|staff')?.textContent?.trim();
      if (st && st !== '1') child.remove();
    }
  }
  m17.querySelectorAll('note staff,note *|staff').forEach((el) => {
    el.textContent = '1';
  });
  pruneCrossStaffTimelineForOsmdPreview(m17, 1);
  snapshotNoteDefaultXForOsmdPreview(m17);
  reorderSingleStaffTimelineByOnsetForOsmdPreview(m17);
  normalizeMultiVoiceLayersForOsmdPreview(m17);
  applyPlayOrderLayoutToMeasure(m17);
  realignMeasureDefaultXFromTimelineForOsmd(m17);

  const layoutLen = measureLengthUnitsExport(m17);
  const timelineEnd = measureTimelineEndUnits(m17);
  if (layoutLen < timelineEnd) {
    throw new Error(`layoutLen ${layoutLen} must be >= timelineEnd ${timelineEnd}`);
  }

  const leaders = [...m17.children].filter(
    (c) => local(c) === 'note' && !c.querySelector('chord,*|chord'),
  ) as Element[];
  const e5 = leaders.find((n) => pitch(n) === 'E5')!;
  const f5 = leaders.find((n) => pitch(n) === 'F5')!;
  const f4Po2 = leaders.find(
    (n) => pitch(n) === 'F4' && n.getAttribute('data-hitl-play-order') === '2',
  )!;
  const f4Po4 = leaders.find(
    (n) => pitch(n) === 'F4' && n.getAttribute('data-hitl-play-order') === '4',
  )!;
  const g4 = leaders.find((n) => pitch(n) === 'G4')!;

  if (!e5 || !f5 || !f4Po2 || !f4Po4 || !g4) {
    throw new Error('missing leaders');
  }
  if (dx(f4Po2) !== dx(e5)) {
    throw new Error(`po2 [F4,Bb4] must share column with E5 got ${dx(f4Po2)} vs ${dx(e5)}`);
  }
  if (dx(f4Po2) >= dx(f5)) {
    throw new Error(`po2 must be left of po3 F5 got ${dx(f4Po2)} >= ${dx(f5)}`);
  }
  if (dx(f5) >= dx(f4Po4)) {
    throw new Error(`po3 F5 must be left of po4 chord got ${dx(f5)} >= ${dx(f4Po4)}`);
  }
  if (dx(f4Po4) >= dx(g4)) {
    throw new Error(`po4 must be left of trailing G4 (not crushed at 432) got ${dx(f4Po4)} >= ${dx(g4)}`);
  }
  const gap34 = dx(f4Po4) - dx(f5);
  const gap23 = dx(f5) - dx(e5);
  if (gap34 > gap23 * 2.5) {
    throw new Error(`po3–po4 gap too wide vs po2–po3: gap23=${gap23} gap34=${gap34}`);
  }

  console.log('OK m17 play-order layoutLen', {
    layoutLen,
    timelineEnd,
    po2: dx(f4Po2),
    po3: dx(f5),
    po4: dx(f4Po4),
    g4: dx(g4),
    gap23,
    gap34,
  });
}

main();
