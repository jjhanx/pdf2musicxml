import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import {
  repairTimelineForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
import {
  coalesceSamePlayOrderOnsetsForOsmdPreview,
  unifyVoiceForSamePlayOrderPreview,
  readPlayOrder,
  HITL_PLAY_ORDER_ATTR,
} from '../shared/musicXmlPlayOrder';
import { collectStaffNoteOnsets } from '../shared/musicXmlPreviewOnsetLayout';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, { document: dom.window.document, DOMParser: dom.window.DOMParser });

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
const pitch = (n: Element) => {
  const step = n.querySelector('step,*|step')?.textContent ?? '';
  const oct = n.querySelector('octave,*|octave')?.textContent ?? '';
  const alter = n.querySelector('alter,*|alter')?.textContent ?? '';
  return `${step}${alter === '-1' ? 'b' : ''}${oct}`;
};

function dump(m17: Element, label: string) {
  console.log('\n===', label, '===');
  const onsets = collectStaffNoteOnsets(m17, 1);
  for (const c of [...m17.children]) {
    if (local(c) !== 'note') continue;
    const p = pitch(c);
    const v = c.querySelector('voice,*|voice')?.textContent;
    const po = c.getAttribute(HITL_PLAY_ORDER_ATTR);
    const chord = c.querySelector('chord,*|chord') ? 'chord' : 'leader';
    if (p === 'F4' || p === 'E5' || p === 'Bb4') console.log(`  ${p} v=${v} po=${po} ${chord} onset=${onsets.get(c)}`);
  }
}

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
dump(m17, 'after staff filter');
pruneCrossStaffTimelineForOsmdPreview(m17, 1);
snapshotNoteDefaultXForOsmdPreview(m17);
reorderSingleStaffTimelineByOnsetForOsmdPreview(m17);
normalizeMultiVoiceLayersForOsmdPreview(m17);
dump(m17, 'after layer norm');
unifyVoiceForSamePlayOrderPreview(m17);
dump(m17, 'after unify voice');
coalesceSamePlayOrderOnsetsForOsmdPreview(m17);
dump(m17, 'after coalesce');
