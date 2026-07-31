/**
 * Diagnose m17 po 2/3/4: [F4,Bb4] vanish + po3/po4 gap.
 * Run: npx tsx _smoke/_diag_m17_po234_vanish.ts
 */
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import {
  repairTimelineForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
  collectStaffNoteOnsets,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
import { applyPlayOrderLayoutToMeasure, measureLengthUnitsExport } from '../shared/musicXmlPlayOrder';

const dom = new JSDOM('');
Object.assign(globalThis, {
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
});

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
const pitch = (n: Element) => {
  const step = n.querySelector('step,*|step')?.textContent ?? '';
  const oct = n.querySelector('octave,*|octave')?.textContent ?? '';
  const alter = n.querySelector('alter,*|alter')?.textContent ?? '';
  return `${step}${alter === '-1' ? 'b' : ''}${oct}`;
};

const raw = execSync('python _smoke/_export_m17_play_order_234.py', { encoding: 'utf8', maxBuffer: 30e6 });
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
m17.querySelectorAll('note staff,note *|staff').forEach((el) => {
  el.textContent = '1';
});
pruneCrossStaffTimelineForOsmdPreview(m17, 1);
snapshotNoteDefaultXForOsmdPreview(m17);
reorderSingleStaffTimelineByOnsetForOsmdPreview(m17);
normalizeMultiVoiceLayersForOsmdPreview(m17);

const onsetsBefore = collectStaffNoteOnsets(m17);
console.log('BEFORE layout');
for (const c of [...m17.children]) {
  if (local(c) !== 'note' || c.querySelector('chord,*|chord')) continue;
  console.log({
    pitch: pitch(c),
    v: c.querySelector('voice,*|voice')?.textContent,
    po: c.getAttribute('data-hitl-play-order'),
    onset: onsetsBefore.get(c),
    x: c.getAttribute('default-x') ?? c.getAttribute('data-osmd-orig-default-x'),
    type: c.querySelector('type,*|type')?.textContent,
  });
}

applyPlayOrderLayoutToMeasure(m17);
realignMeasureDefaultXFromTimelineForOsmd(m17);

import { measureLengthUnits, measureTimelineEndUnits, defaultXFromOnset } from '../shared/musicXmlPreviewOnsetLayout';
const attrs = [...m17.children].find((c) => local(c) === 'attributes');
console.log('attrs html', attrs?.innerHTML?.slice(0, 500));
console.log('measureLengthUnits', measureLengthUnits(m17));
console.log('timelineEnd', measureTimelineEndUnits(m17));
console.log('want x for onset 2/3/4/6 with len', measureLengthUnits(m17), {
  2: defaultXFromOnset(2, measureLengthUnits(m17)),
  3: defaultXFromOnset(3, measureLengthUnits(m17)),
  4: defaultXFromOnset(4, measureLengthUnits(m17)),
  6: defaultXFromOnset(6, measureLengthUnits(m17)),
});
console.log('want x with timelineEnd', measureTimelineEndUnits(m17), {
  2: defaultXFromOnset(2, measureTimelineEndUnits(m17)),
  3: defaultXFromOnset(3, measureTimelineEndUnits(m17)),
  4: defaultXFromOnset(4, measureTimelineEndUnits(m17)),
  6: defaultXFromOnset(6, measureTimelineEndUnits(m17)),
});

console.log('AFTER layout len=', measureLengthUnitsExport(m17));
for (const c of [...m17.children]) {
  if (local(c) !== 'note' || c.querySelector('chord,*|chord')) continue;
  console.log({
    pitch: pitch(c),
    v: c.querySelector('voice,*|voice')?.textContent,
    po: c.getAttribute('data-hitl-play-order'),
    x: c.getAttribute('default-x'),
    type: c.querySelector('type,*|type')?.textContent,
  });
}
