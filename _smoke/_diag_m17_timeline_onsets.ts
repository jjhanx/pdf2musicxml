/**
 * Dump m17 PR timeline after full preview+sanitize — check voice onsets for F4 po2 vs E5.
 * Run: npx tsx _smoke/_diag_m17_timeline_onsets.ts
 */
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import {
  repairTimelineForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
  stripDefaultXyKeepLayoutAttrsForOsmdPreview,
  collectStaffNoteOnsets,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
import { applyPlayOrderLayoutToMeasure } from '../shared/musicXmlPlayOrder';
import { repairRestDisplayForOsmdPreview, repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd';
import { OSMD_LAYOUT_X_ATTR } from '../shared/musicXmlPreviewOnsetLayout';

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
for (const part of [...doc.querySelectorAll('part,*|part')]) {
  if (part.getAttribute('id') !== 'P5') part.remove();
}
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
realignMeasureDefaultXFromTimelineForOsmd(m17);
applyPlayOrderLayoutToMeasure(m17);

console.log('=== measure children (timeline) ===');
for (const c of [...m17.children]) {
  const tag = local(c);
  if (tag === 'note') {
    const chord = c.querySelector('chord,*|chord') ? '*' : '';
    console.log(
      `note ${pitch(c)}${chord} v=${c.querySelector('voice,*|voice')?.textContent} dur=${c.querySelector('duration,*|duration')?.textContent} type=${c.querySelector('type,*|type')?.textContent} po=${c.getAttribute('data-hitl-play-order')} lx=${c.getAttribute(OSMD_LAYOUT_X_ATTR)} dx=${c.getAttribute('default-x')}`,
    );
  } else if (tag === 'backup' || tag === 'forward') {
    console.log(
      `${tag} dur=${c.querySelector('duration,*|duration')?.textContent} v=${c.querySelector('voice,*|voice')?.textContent ?? '-'}`,
    );
  } else if (tag === 'attributes' || tag === 'print' || tag === 'direction') {
    console.log(tag);
  }
}

const onsets = collectStaffNoteOnsets(m17);
console.log('=== single-cursor onsets (collectStaffNoteOnsets) ===');
for (const [n, t] of onsets) {
  if (n.querySelector('chord,*|chord')) continue;
  console.log(`${pitch(n)} v=${n.querySelector('voice,*|voice')?.textContent} onset=${t} po=${n.getAttribute('data-hitl-play-order')}`);
}

// per-voice cursor (like OSMD)
const voiceCursor = new Map<string, number>();
let lastV = '1';
console.log('=== per-voice onsets ===');
for (const c of [...m17.children]) {
  const tag = local(c);
  if (tag === 'backup') {
    const v = c.querySelector('voice,*|voice')?.textContent?.trim() || lastV;
    const d = parseInt(c.querySelector('duration,*|duration')?.textContent ?? '0', 10);
    voiceCursor.set(v, Math.max(0, (voiceCursor.get(v) ?? 0) - d));
  } else if (tag === 'forward') {
    const v = c.querySelector('voice,*|voice')?.textContent?.trim() || lastV;
    const d = parseInt(c.querySelector('duration,*|duration')?.textContent ?? '0', 10);
    voiceCursor.set(v, (voiceCursor.get(v) ?? 0) + d);
  } else if (tag === 'note' && !c.querySelector('chord,*|chord')) {
    const v = c.querySelector('voice,*|voice')?.textContent?.trim() || '1';
    lastV = v;
    const start = voiceCursor.get(v) ?? 0;
    const d = parseInt(c.querySelector('duration,*|duration')?.textContent ?? '0', 10);
    console.log(`${pitch(c)} v=${v} onset=${start} po=${c.getAttribute('data-hitl-play-order')}`);
    voiceCursor.set(v, start + d);
  }
}

let out = new XMLSerializer().serializeToString(doc);
out = repairRestDisplayForOsmdPreview(out);
out = repairMissingNoteTypesForOsmdPreview(out);
out = repairTimelineForOsmdPreview(out);
out = repairUnderfullMeasuresForOsmdPreview(out);
out = stripDefaultXyKeepLayoutAttrsForOsmdPreview(out);
const doc2 = new DOMParser().parseFromString(out, 'text/xml');
const m172 = [...doc2.querySelectorAll('part,*|part')]
  .find((p) => p.getAttribute('id') === 'P5')!
  .querySelectorAll('measure,*|measure');
const m17b = [...m172].find((m) => m.getAttribute('number') === '17')!;
console.log('=== after sanitize strip: has default-x?', /default-x=/.test(m17b.outerHTML));
console.log('layout-x sample', [...m17b.querySelectorAll('note')].slice(0, 3).map((n) => n.getAttribute(OSMD_LAYOUT_X_ATTR)));
