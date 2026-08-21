/**
 * e427 m10 PL: preview must keep all pitched notes with real durations.
 * Run: npx tsx _smoke/test_e427_m10_pl_preview.ts
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import {
  repairTimelineForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
  capBackupDurationsForOsmdPreview,
} from '../shared/musicXmlTimelineCleanup.ts';
import { parseMusicXmlDocument } from '../shared/musicXmlParse.ts';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
});

execSync('python _smoke/_dump_e427_m10.py', { stdio: 'pipe' });
const rawXml = fs.readFileSync('_smoke/_e427_review.xml', 'utf8');

function local(el: Element): string {
  return el.localName?.toLowerCase() ?? '';
}
function noteStaff(n: Element): number {
  return parseInt(n.querySelector(':scope > staff, :scope > *|staff')?.textContent || '1', 10) || 1;
}
function durOf(n: Element): number {
  return parseInt(n.querySelector(':scope > duration, :scope > *|duration')?.textContent || '0', 10) || 0;
}
function pitchOf(n: Element): string {
  if (n.querySelector('rest, *|rest')) return 'REST';
  return (
    (n.querySelector('step, *|step')?.textContent || '') +
    (n.querySelector('octave, *|octave')?.textContent || '')
  );
}

// 1) cap must not crush PL durations to 1 after PR fills the measure
const afterCap = capBackupDurationsForOsmdPreview(rawXml);
{
  const doc = parseMusicXmlDocument(afterCap)!;
  const part = [...doc.querySelectorAll('part')].find((p) => p.getAttribute('id') === 'P5')!;
  const m10 = [...part.children].find(
    (c) => local(c) === 'measure' && c.getAttribute('number') === '10',
  )! as Element;
  const pl = [...m10.children].filter(
    (c) => local(c) === 'note' && noteStaff(c) === 2 && !c.querySelector('chord, *|chord'),
  );
  const durs = pl.map((n) => `${pitchOf(n)}:${durOf(n)}`);
  console.log('after cap', durs.join(' '));
  const c3 = pl.find((n) => pitchOf(n) === 'C3');
  const g3 = pl.find((n) => pitchOf(n) === 'G3');
  const a2 = pl.find((n) => pitchOf(n) === 'A2');
  if (!c3 || durOf(c3) < 12) throw new Error(`C3 duration crushed: ${durs.join(' ')}`);
  if (!g3 || durOf(g3) < 36) throw new Error(`G3 duration crushed: ${durs.join(' ')}`);
  if (!a2 || durOf(a2) < 96) throw new Error(`A2 duration crushed: ${durs.join(' ')}`);
}

// 2) full PL preview path keeps all pitched leaders
let raw = repairTimelineForOsmdPreview(rawXml);
const doc = parseMusicXmlDocument(raw)!;
const part = [...doc.querySelectorAll('part')].find((p) => p.getAttribute('id') === 'P5')!;
const m10 = [...part.children].find(
  (c) => local(c) === 'measure' && c.getAttribute('number') === '10',
)! as Element;

for (const c of [...m10.children]) {
  if (local(c) === 'note' && noteStaff(c) !== 2) c.remove();
}
pruneCrossStaffTimelineForOsmdPreview(m10, 2);
snapshotNoteDefaultXForOsmdPreview(m10);
reorderSingleStaffTimelineByOnsetForOsmdPreview(m10);
normalizeMultiVoiceLayersForOsmdPreview(m10);
realignMeasureDefaultXFromTimelineForOsmd(m10);

const pitched = [...m10.children]
  .filter(
    (n) =>
      local(n) === 'note' &&
      !n.querySelector('rest, *|rest') &&
      !n.querySelector('chord, *|chord') &&
      n.querySelector('pitch, *|pitch'),
  )
  .map((n) => `${pitchOf(n)}:${durOf(n)}`);
console.log('after PL normalize', pitched.join(' '));
for (const need of ['C3', 'E3', 'G3', 'B2', 'A2']) {
  if (!pitched.some((p) => p.startsWith(need + ':'))) {
    throw new Error(`missing ${need} in ${pitched.join(' ')}`);
  }
}
if (pitched.some((p) => /:(1)$/.test(p) && !p.startsWith('REST'))) {
  // allow nothing crushed to 1 among pitched
  const crushed = pitched.filter((p) => /:1$/.test(p));
  if (crushed.length) throw new Error(`pitched durations crushed to 1: ${crushed.join(' ')}`);
}
console.log('e427 m10 PL preview ok');
