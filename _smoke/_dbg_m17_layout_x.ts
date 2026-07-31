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
import { dedupeSamePlayOrderPitchLayersForOsmdPreview } from '../shared/musicXmlPlayOrder';
import { collectStaffNoteOnsets } from '../shared/musicXmlPreviewOnsetLayout';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, { document: dom.window.document, DOMParser: dom.window.DOMParser });

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
const pitch = (n: Element) => {
  const s = n.querySelector('step,*|step')?.textContent ?? '';
  const o = n.querySelector('octave,*|octave')?.textContent ?? '';
  return `${s}${o}`;
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
dedupeSamePlayOrderPitchLayersForOsmdPreview(m17);
realignMeasureDefaultXFromTimelineForOsmd(m17);

const onsets = collectStaffNoteOnsets(m17, 1);
for (const c of [...m17.children]) {
  if (local(c) !== 'note' || c.querySelector('chord,*|chord')) continue;
  const v = c.querySelector('voice,*|voice')?.textContent;
  console.log(pitch(c), 'v', v, 'raw', onsets.get(c), 'dx', c.getAttribute('default-x'), 'po', c.getAttribute('data-hitl-play-order'));
}
