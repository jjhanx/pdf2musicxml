/** Check hints + default-x after full preview pipeline (no AudiverisInspectPanel import). */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import {
  repairTimelineForOsmdPreview,
  collectLinkedParallelOnsetHintsFromXml,
  snapshotNoteDefaultXForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
} from '../shared/musicXmlTimelineCleanup';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
});
const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function buildPr(raw: string): string {
  let xml = repairTimelineForOsmdPreview(raw);
  const doc0 = new DOMParser().parseFromString(xml, 'text/xml');
  const p5 = [...doc0.querySelectorAll('part,*|part')].find((p) => {
    const id = p.getAttribute('id') ?? '';
    return id === 'P5' || id.endsWith(':P5');
  });
  if (!p5) throw new Error('P5 missing');
  const score = doc0.querySelector('score-partwise,*|score-partwise')!;
  [...score.querySelectorAll('part,*|part')].forEach((p) => {
    if (p !== p5) p.remove();
  });
  xml = new XMLSerializer().serializeToString(doc0);
  xml = repairUnderfullMeasuresForOsmdPreview(xml);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const part = [...doc.querySelectorAll('part,*|part')][0]!;
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
    snapshotNoteDefaultXForOsmdPreview(measure);
    reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
    normalizeMultiVoiceLayersForOsmdPreview(measure);
    realignMeasureDefaultXFromTimelineForOsmd(measure);
  }
  return repairTimelineForOsmdPreview(new XMLSerializer().serializeToString(doc));
}

function pitch(n: Element): string {
  const step = n.querySelector('step,*|step')?.textContent ?? '';
  const oct = n.querySelector('octave,*|octave')?.textContent ?? '';
  const alter = n.querySelector('alter,*|alter')?.textContent ?? '';
  return `${step}${alter === '-1' ? 'b' : ''}${oct}`;
}

const raw = fs.existsSync('_smoke/_m17_linked.xml')
  ? fs.readFileSync('_smoke/_m17_linked.xml', 'utf8')
  : execSync('python _smoke/_export_m17_parallel_fix.py', { encoding: 'utf8', maxBuffer: 20e6 });

const pr = buildPr(raw);
const hints = collectLinkedParallelOnsetHintsFromXml(pr).filter((h) => h.measureNumber === 17);
console.log('hints', hints);

const doc = new DOMParser().parseFromString(pr, 'text/xml');
const part = [...doc.querySelectorAll('part,*|part')][0]!;
const m17 = [...part.children].find(
  (c) => local(c as Element) === 'measure' && (c as Element).getAttribute('number') === '17',
)!;
for (const c of [...m17.children]) {
  if (local(c) !== 'note') continue;
  const ch = c.querySelector('chord,*|chord');
  console.log(
    pitch(c),
    'v',
    c.querySelector('voice,*|voice')?.textContent,
    'x',
    c.getAttribute('default-x'),
    ch ? '(chord)' : '',
  );
}
