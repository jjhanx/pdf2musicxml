/**
 * m17 PR: same play order → same default-x + align group (F4/Bb4/E5).
 * Run: npx tsx _smoke/test_m17_play_order_align.ts
 */
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { applyPlayOrderLayoutToMeasure, collectPlayOrderAlignGroupsFromXml, HITL_PLAY_ORDER_ATTR } from '../shared/musicXmlPlayOrder';
import {
  repairTimelineForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
import { serializeMusicXmlDocument } from '../shared/musicXmlParse';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, { document: dom.window.document, DOMParser: dom.window.DOMParser, XMLSerializer: dom.window.XMLSerializer });

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
const pitch = (note: Element) => {
  const step = note.querySelector('step,*|step')?.textContent?.trim() ?? '';
  const alter = note.querySelector('alter,*|alter')?.textContent?.trim();
  const oct = note.querySelector('octave,*|octave')?.textContent?.trim() ?? '';
  const acc = alter === '-1' ? 'b' : alter === '1' ? '#' : '';
  return `${step}${acc}${oct}`;
};

function buildM17Pr(raw: string): string {
  let xml = repairTimelineForOsmdPreview(raw);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
  for (const measure of [...part.children]) {
    if (local(measure) !== 'measure' || measure.getAttribute('number') !== '17') continue;
    for (const child of [...measure.children]) {
      if (local(child) === 'note') {
        const st = child.querySelector('staff,*|staff')?.textContent?.trim();
        if (st && st !== '1') child.remove();
      }
    }
    measure.querySelectorAll('note staff,note *|staff').forEach((el) => {
      el.textContent = '1';
    });
    pruneCrossStaffTimelineForOsmdPreview(measure, 1);
    snapshotNoteDefaultXForOsmdPreview(measure);
    reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
    normalizeMultiVoiceLayersForOsmdPreview(measure);
    for (const note of [...measure.children]) {
      if (local(note) !== 'note') continue;
      const p = pitch(note as Element);
      if (p === 'F4' || p === 'Bb4' || p === 'E5') {
        (note as Element).setAttribute(HITL_PLAY_ORDER_ATTR, '2');
      }
    }
    applyPlayOrderLayoutToMeasure(measure);
  }
  const m17 = [...part.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === '17')!;
  const wrap = new DOMParser().parseFromString(
    `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P5"><part-name/></score-part></part-list><part id="P5">${m17.outerHTML}</part></score-partwise>`,
    'text/xml',
  );
  return serializeMusicXmlDocument(wrap);
}

const raw = execSync('python _smoke/_export_m17_parallel_fix.py', { encoding: 'utf8', maxBuffer: 20e6 });
const preview = buildM17Pr(raw);
const groups = collectPlayOrderAlignGroupsFromXml(preview);
const g = groups.find((x) => x.measureNumber === 17 && x.playOrder === 2);
if (!g || g.members.length < 3) throw new Error(`expected play-order group 2 with 3 members got ${JSON.stringify(groups)}`);

const doc = new DOMParser().parseFromString(preview, 'text/xml');
const xs = new Set<string>();
for (const note of [...doc.querySelectorAll('part[id="P5"] > measure[number="17"] > note')]) {
  if (note.querySelector('chord,*|chord')) continue;
  if (note.getAttribute(HITL_PLAY_ORDER_ATTR) !== '2') continue;
  xs.add(note.getAttribute('default-x') ?? '');
}
if (xs.size !== 1) throw new Error(`parallel play order must share default-x got ${[...xs]}`);
console.log('OK m17 play order align', { group: g, defaultX: [...xs][0] });
