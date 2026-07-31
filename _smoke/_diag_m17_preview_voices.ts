/** Dump m17 preview voices + default-x after pipeline steps */
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
  const s = n.querySelector('step,*|step')?.textContent ?? '';
  const o = n.querySelector('octave,*|octave')?.textContent ?? '';
  return s + o;
};

function dump(label: string, m17: Element) {
  console.log('\n===', label, '===');
  for (const ch of [...m17.children]) {
    if (local(ch) !== 'note') continue;
    const n = ch as Element;
    if (n.querySelector('chord,*|chord')) continue;
    console.log(
      pitch(n),
      'v=' + (n.querySelector('voice,*|voice')?.textContent ?? '?'),
      'dur=' + (n.querySelector('duration,*|duration')?.textContent ?? '?'),
      'x=' + n.getAttribute('default-x'),
      'po=' + n.getAttribute('data-hitl-play-order'),
    );
  }
}

const raw = execSync('python _smoke/_export_m17_play_order2.py', { encoding: 'utf8', maxBuffer: 20e6 });
let xml = repairTimelineForOsmdPreview(raw);
const doc = new DOMParser().parseFromString(xml, 'text/xml');
const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
const m17 = [...part.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === '17') as Element;
for (const child of [...m17.children]) {
  if (local(child) === 'note' && noteStaffN(child as Element) !== 1) child.remove();
}
m17.querySelectorAll('note staff,note *|staff').forEach((el) => { el.textContent = '1'; });

function noteStaffN(note: Element): number {
  const st = note.querySelector('staff,*|staff')?.textContent?.trim();
  return st && /^\d+$/.test(st) ? parseInt(st, 10) : 1;
}

pruneCrossStaffTimelineForOsmdPreview(m17, 1);
snapshotNoteDefaultXForOsmdPreview(m17);
reorderSingleStaffTimelineByOnsetForOsmdPreview(m17);
normalizeMultiVoiceLayersForOsmdPreview(m17);
dump('before unifyVoice', m17);
unifyVoiceForSamePlayOrderPreview(m17);
dump('after unifyVoice', m17);
realignMeasureDefaultXFromTimelineForOsmd(m17);
dump('after realign', m17);
