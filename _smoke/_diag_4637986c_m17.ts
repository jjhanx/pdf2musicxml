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
import {
  collectStaffNoteOnsets,
  measureLengthUnits,
  measureTimelineEndUnits,
} from '../shared/musicXmlPreviewOnsetLayout';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, { document: dom.window.document, DOMParser: dom.window.DOMParser });

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
const pitch = (n: Element) => {
  const step = n.querySelector('step,*|step')?.textContent ?? '';
  const oct = n.querySelector('octave,*|octave')?.textContent ?? '';
  const alter = n.querySelector('alter,*|alter')?.textContent?.trim();
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

const raw = execSync('python _smoke/_export_4637986c_review.py', { encoding: 'utf8', maxBuffer: 30e6 });
const m17 = buildM17(raw);
const onsets = collectStaffNoteOnsets(m17, 1);
console.log('nominalLen', measureLengthUnits(m17), 'timelineEnd', measureTimelineEndUnits(m17, 1));
console.log('leaders:');
for (const c of [...m17.children]) {
  if (local(c) !== 'note' || c.querySelector('chord,*|chord')) continue;
  const p = pitch(c);
  const v = c.querySelector('voice,*|voice')?.textContent;
  const po = c.getAttribute('data-hitl-play-order');
  const dur = c.querySelector('duration,*|duration')?.textContent;
  const typ = c.querySelector('type,*|type')?.textContent;
  console.log(
    `  ${p} v=${v} po=${po ?? '-'} onset=${onsets.get(c)} dur=${dur} type=${typ} x=${c.getAttribute('default-x')} orig=${c.getAttribute('data-osmd-orig-default-x')}`,
  );
}
