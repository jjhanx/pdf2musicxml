/**
 * e363 m9 PL: backup 뒤 forward는 멜로디 성부에, 스퓨리어스 REST는 제거, E3→E4 slur 유지.
 * Run: npx tsx _smoke/test_e363_m9_pl_slur_timeline.ts
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import {
  normalizeMultiVoiceLayersForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
  repairTimelineForOsmdPreview,
} from '../shared/musicXmlTimelineCleanup.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';
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

execSync('python _smoke/_extract_e363_review.py', { stdio: 'inherit' });
const raw = repairTimelineForOsmdPreview(fs.readFileSync('_smoke/_e363_review.xml', 'utf8'));

function local(el: Element): string {
  return el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
}

function noteStaff(n: Element): number {
  return parseInt(n.querySelector(':scope > staff')?.textContent?.trim() ?? '1', 10) || 1;
}

const doc = parseMusicXmlDocument(raw)!;
const part = [...doc.querySelectorAll('part')].find((p) => p.getAttribute('id') === 'P5')!;
const m9 = [...part.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === '9')!;

for (const child of [...m9.children]) {
  if (local(child) === 'note' && noteStaff(child) !== 2) child.remove();
}
pruneCrossStaffTimelineForOsmdPreview(m9, 2);
snapshotNoteDefaultXForOsmdPreview(m9);
reorderSingleStaffTimelineByOnsetForOsmdPreview(m9);
const changed = normalizeMultiVoiceLayersForOsmdPreview(m9);
realignMeasureDefaultXFromTimelineForOsmd(m9);
if (!changed) throw new Error('expected multi-voice layer normalize');

const timeline: string[] = [];
let sawE3 = false;
let restBeforeE3 = false;
let forwardBeforeE3 = false;
let slurStart = false;
let slurStop = false;
let orphanTail = false;
let passedNotes = false;

for (const el of [...m9.children]) {
  const tag = local(el);
  if (tag === 'forward') {
    const d = el.querySelector('duration')?.textContent ?? '?';
    timeline.push(`forward(${d})`);
    if (!sawE3) forwardBeforeE3 = d === '9';
    if (passedNotes) orphanTail = true;
  } else if (tag === 'backup') {
    timeline.push(`backup(${el.querySelector('duration')?.textContent})`);
  } else if (tag === 'note') {
    passedNotes = true;
    const rest = !!el.querySelector('rest');
    const step =
      (el.querySelector('step')?.textContent ?? '') + (el.querySelector('octave')?.textContent ?? '');
    const lab = rest ? 'REST' : step;
    timeline.push(lab);
    if (rest && !sawE3) restBeforeE3 = true;
    if (lab === 'E3') {
      sawE3 = true;
      slurStart = [...el.querySelectorAll('slur')].some((s) => s.getAttribute('type') === 'start');
    }
    if (lab === 'E4') {
      slurStop = [...el.querySelectorAll('slur')].some((s) => s.getAttribute('type') === 'stop');
    }
  }
}

console.log('PL m9 timeline:', timeline.join(' → '));

if (restBeforeE3) throw new Error('spurious REST before E3 should be dropped');
if (!forwardBeforeE3) throw new Error('forward(9) must precede E3 melody');
if (!slurStart || !slurStop) throw new Error('E3→E4 slur missing');
if (orphanTail) throw new Error('orphan forward/backup after notes');
if (!timeline.includes('E3') || !timeline.includes('E4')) throw new Error('melody notes missing');

fs.writeFileSync('_smoke/_e363_pl_m9_fixed.xml', serializeMusicXmlDocument(doc));
console.log('e363 m9 PL slur timeline ok');
