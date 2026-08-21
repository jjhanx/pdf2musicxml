/**
 * 6497 m10 PL: stem/beam Audiveris default-y must be stripped for OSMD beams.
 * Run: npx tsx _smoke/test_6497_m10_pl_beam.ts
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import {
  repairTimelineForOsmdPreview,
  stripDefaultXyForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
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

execSync('python _smoke/_dump_6497_m10.py', { stdio: 'pipe' });
const rawXml = fs.readFileSync('_smoke/_6497_review.xml', 'utf8');

function local(el: Element): string {
  return el.localName?.toLowerCase() ?? '';
}
function noteStaff(n: Element): number {
  return parseInt(n.querySelector(':scope > staff, :scope > *|staff')?.textContent || '1', 10) || 1;
}
function label(n: Element): string {
  if (n.querySelector('rest, *|rest')) return 'REST';
  return (
    (n.querySelector('step, *|step')?.textContent || '') +
    (n.querySelector('octave, *|octave')?.textContent || '')
  );
}
function beamsOf(n: Element): string {
  return [...n.querySelectorAll(':scope > beam, :scope > *|beam')]
    .map((b) => `${b.getAttribute('number') || '1'}:${(b.textContent || '').trim()}`)
    .join(',');
}

// Raw C3/E3 must carry stem default-y (Audiveris) — the bug input
{
  const doc = parseMusicXmlDocument(rawXml)!;
  const part = [...doc.querySelectorAll('part')].find((p) => p.getAttribute('id') === 'P5')!;
  const m10 = [...part.children].find(
    (c) => local(c) === 'measure' && c.getAttribute('number') === '10',
  )! as Element;
  const c3 = [...m10.children].find(
    (n) => local(n) === 'note' && label(n) === 'C3' && noteStaff(n) === 2 && !n.querySelector('chord'),
  )!;
  const stem = c3.querySelector(':scope > stem, :scope > *|stem');
  if (!stem?.getAttribute('default-y')) {
    throw new Error('fixture expected C3 stem default-y from Audiveris');
  }
}

const stripped = stripDefaultXyForOsmdPreview(rawXml);
{
  const doc = parseMusicXmlDocument(stripped)!;
  const part = [...doc.querySelectorAll('part')].find((p) => p.getAttribute('id') === 'P5')!;
  const m10 = [...part.children].find(
    (c) => local(c) === 'measure' && c.getAttribute('number') === '10',
  )! as Element;
  for (const n of [...m10.children]) {
    if (local(n) !== 'note' || noteStaff(n) !== 2) continue;
    const stem = n.querySelector(':scope > stem, :scope > *|stem');
    if (stem?.hasAttribute('default-y') || stem?.hasAttribute('default-x')) {
      throw new Error(`${label(n)} stem still has default-x/y after strip`);
    }
    for (const b of n.querySelectorAll(':scope > beam, :scope > *|beam')) {
      if (b.hasAttribute('default-y') || b.hasAttribute('default-x')) {
        throw new Error(`${label(n)} beam still has default-x/y after strip`);
      }
    }
  }
  console.log('stripDefaultXy clears stem/beam coords ok');
}

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

const c3 = [...m10.children].find(
  (n) => local(n) === 'note' && label(n) === 'C3' && !n.querySelector('chord'),
)!;
const e3 = [...m10.children].find(
  (n) => local(n) === 'note' && label(n) === 'E3' && !n.querySelector('chord'),
)!;
if (!beamsOf(c3).includes('begin') || !beamsOf(e3).includes('end')) {
  throw new Error(`beam tags lost: C3=${beamsOf(c3)} E3=${beamsOf(e3)}`);
}
const stem = c3.querySelector(':scope > stem, :scope > *|stem');
if (stem?.hasAttribute('default-y')) {
  throw new Error('C3 stem default-y survived full repair+PL transform');
}
console.log('6497 m10 PL beam coords ok', beamsOf(c3), beamsOf(e3));
