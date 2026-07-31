/** Dump m17 default-x after verbatim PR preview transforms + hints */
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import {
  repairTimelineForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
  collectLinkedParallelOnsetHintsFromXml,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
});

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function measureHasLeadingForward(measure: Element): boolean {
  for (const child of [...measure.children]) {
    const tag = local(child);
    if (tag === 'forward') return true;
    if (tag === 'note') return false;
  }
  return false;
}

function dumpMeasure(measure: Element, title: string): void {
  console.log(title);
  let t = 0;
  const vc = new Map<string, number>();
  for (const child of [...measure.children]) {
    const tag = local(child);
    if (tag === 'forward') {
      const v = child.querySelector('voice,*|voice')?.textContent?.trim() || '1';
      const d = parseInt(child.querySelector('duration,*|duration')?.textContent?.trim() ?? '0', 10);
      vc.set(v, (vc.get(v) ?? 0) + d);
      console.log(`  forward v=${v} d=${d}`);
    } else if (tag === 'note') {
      const chord = child.querySelector('chord,*|chord') !== null;
      if (chord) continue;
      const v = child.querySelector('voice,*|voice')?.textContent?.trim() || '1';
      t = vc.get(v) ?? 0;
      const step = child.querySelector('step,*|step')?.textContent ?? '?';
      const oct = child.querySelector('octave,*|octave')?.textContent ?? '';
      const alter = child.querySelector('alter,*|alter')?.textContent;
      const acc = alter === '-1' ? 'b' : alter === '1' ? '#' : '';
      const x = child.getAttribute('default-x');
      const orig = child.getAttribute('data-osmd-orig-default-x');
      console.log(`  ${step}${acc}${oct} v=${v} t=${t} x=${x} orig=${orig}`);
      vc.set(v, t + parseInt(child.querySelector('duration,*|duration')?.textContent?.trim() ?? '0', 10));
    }
  }
}

const raw = execSync('python _smoke/_export_m17_parallel_fix.py', { encoding: 'utf8', maxBuffer: 20e6 });
let xml = repairTimelineForOsmdPreview(raw);
const doc = new DOMParser().parseFromString(xml, 'text/xml');
const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
for (const measure of [...part.children]) {
  if (local(measure) !== 'measure') continue;
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
  if (!measureHasLeadingForward(measure)) {
    // skip flatten for m17
  }
  snapshotNoteDefaultXForOsmdPreview(measure);
  reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
  normalizeMultiVoiceLayersForOsmdPreview(measure);
  realignMeasureDefaultXFromTimelineForOsmd(measure);
}
xml = new XMLSerializer().serializeToString(doc);
xml = repairTimelineForOsmdPreview(xml);
const doc2 = new DOMParser().parseFromString(xml, 'text/xml');
const part2 = [...doc2.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
const m17 = [...part2.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === '17')!;
dumpMeasure(m17, 'm17 after final repairTimeline:');
console.log('hints:', collectLinkedParallelOnsetHintsFromXml(xml).filter((h) => h.measureNumber === 17));
