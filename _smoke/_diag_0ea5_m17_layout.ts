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
  return `${step}${oct}`;
};

const raw = execSync('python _smoke/_export_m17_play_order2.py', { encoding: 'utf8', maxBuffer: 20e6 });
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

for (const c of [...m17.children]) {
  if (local(c) !== 'note' || c.querySelector('chord,*|chord')) continue;
  console.log(pitch(c), 'x=' + c.getAttribute('default-x'), 'orig=' + c.getAttribute('data-osmd-orig-default-x'), 'po=' + c.getAttribute('data-hitl-play-order'));
}
