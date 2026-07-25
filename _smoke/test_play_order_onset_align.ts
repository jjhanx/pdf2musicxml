/**
 * setPlayOrder: 박자 다른 음은 chord 병합하지 않고 type/duration·default-x만 맞춤.
 * Run: npx tsx _smoke/test_play_order_onset_align.ts
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
  unifyVoiceForSamePlayOrderPreview,
  collectPlayOrderAlignGroupsFromXml,
  HITL_PLAY_ORDER_ATTR,
} from '../shared/musicXmlPlayOrder';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
});

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
const pitch = (n: Element) => {
  const step = n.querySelector('step,*|step')?.textContent ?? '';
  const oct = n.querySelector('octave,*|octave')?.textContent ?? '';
  const alter = n.querySelector('alter,*|alter')?.textContent ?? '';
  return `${step}${alter === '-1' ? 'b' : ''}${oct}`;
};

function buildPrM17(raw: string): string {
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
  unifyVoiceForSamePlayOrderPreview(m17);
  realignMeasureDefaultXFromTimelineForOsmd(m17);
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><part-list><score-part id="P5"><part-name/></score-part></part-list><part id="P5">${m17.outerHTML}</part></score-partwise>`;
}

function main() {
  if (!fs.existsSync('omr-work-0ea5ea52.zip')) {
    console.log('skip');
    return;
  }
  const raw = execSync('python _smoke/_export_m17_play_order2.py', { encoding: 'utf8', maxBuffer: 20e6 });
  const preview = buildPrM17(raw);
  const doc = new DOMParser().parseFromString(preview, 'text/xml');
  const m17 = doc.querySelector('part[id="P5"] > measure[number="17"]')!;
  const f4 = [...m17.children].find(
    (c) => local(c) === 'note' && pitch(c as Element) === 'F4' && !(c as Element).querySelector('chord,*|chord'),
  ) as Element;
  const e5 = [...m17.children].find(
    (c) => local(c) === 'note' && pitch(c as Element) === 'E5' && !(c as Element).querySelector('chord,*|chord'),
  ) as Element;
  if (!f4 || !e5) throw new Error('F4/E5 leader missing');
  if (f4.getAttribute(HITL_PLAY_ORDER_ATTR) !== '2' || e5.getAttribute(HITL_PLAY_ORDER_ATTR) !== '2') {
    throw new Error('play order attrs missing');
  }
  const f4Type = f4.querySelector('type,*|type')?.textContent;
  const e5Type = e5.querySelector('type,*|type')?.textContent;
  if (f4Type !== 'quarter' || e5Type !== 'eighth') {
    throw new Error(`duration types must stay quarter+eighth got ${f4Type}+${e5Type}`);
  }
  const f4x = f4.getAttribute('default-x');
  const e5x = e5.getAttribute('default-x');
  if (!f4x || f4x !== e5x) throw new Error(`same play order must share default-x got F4=${f4x} E5=${e5x}`);

  const groups = collectPlayOrderAlignGroupsFromXml(preview);
  const g = groups.find((x) => x.measureNumber === 17 && x.playOrder === 2);
  if (!g?.members.some((m) => m.pitch === 'F4') || !g?.members.some((m) => m.pitch === 'E5')) {
    throw new Error(`expected F4+E5 SVG align group got ${JSON.stringify(groups)}`);
  }
  console.log('OK play order preview: no chord merge, shared default-x', { f4Type, e5Type, defaultX: f4x });
}

main();
