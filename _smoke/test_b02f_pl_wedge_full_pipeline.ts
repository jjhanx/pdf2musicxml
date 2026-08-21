/**
 * Full PL transform for b02f m9 wedges — dump final timeline + reattach survival.
 * Run: npx tsx _smoke/test_b02f_pl_wedge_full_pipeline.ts
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
  reanchorWedgeStopsForOsmdPreview,
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

execSync('python _smoke/_dump_b02f_m9.py', { stdio: 'inherit' });
let raw = fs.readFileSync('_smoke/_b02f_review.xml', 'utf8');
raw = repairTimelineForOsmdPreview(raw);

function local(el: Element): string {
  return el.localName?.toLowerCase() ?? '';
}
function noteStaff(n: Element): number {
  return parseInt(n.querySelector(':scope > staff')?.textContent || '1', 10) || 1;
}

const doc = parseMusicXmlDocument(raw)!;
const part = [...doc.querySelectorAll('part')].find((p) => p.getAttribute('id') === 'P5')!;
const m9 = [...part.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === '9')! as Element;

for (const c of [...m9.children]) {
  if (local(c) === 'note' && noteStaff(c) !== 2) c.remove();
}
pruneCrossStaffTimelineForOsmdPreview(m9, 2);
snapshotNoteDefaultXForOsmdPreview(m9);
reorderSingleStaffTimelineByOnsetForOsmdPreview(m9);
normalizeMultiVoiceLayersForOsmdPreview(m9);
realignMeasureDefaultXFromTimelineForOsmd(m9);
reanchorWedgeStopsForOsmdPreview(m9, 2);

const dirsAfterNorm = [...m9.children].filter(
  (d) => local(d) === 'direction' && d.querySelector('wedge, *|wedge'),
);
if (dirsAfterNorm.length < 2) {
  console.error('FAIL: wedges lost during normalize', dirsAfterNorm.length);
  process.exit(1);
}
for (const d of dirsAfterNorm) {
  const st = d.querySelector(':scope > staff, :scope > *|staff')?.textContent?.trim();
  if (st !== '2') {
    console.error('FAIL: direction staff stripped during normalize', st);
    process.exit(1);
  }
}

for (const d of dirsAfterNorm) {
  const wt = d.querySelector('wedge')?.getAttribute('type');
  const kids = [...m9.children];
  const idx = kids.indexOf(d);
  if (wt === 'stop') {
    for (let j = idx - 1; j >= 0; j -= 1) {
      if (local(kids[j]!) === 'backup') break;
      if (local(kids[j]!) === 'note' && !kids[j]!.querySelector('chord')) {
        const v = kids[j]!.querySelector('voice')?.textContent;
        let dv = d.querySelector('voice');
        if (!dv) {
          dv = doc.createElementNS(d.namespaceURI, 'voice');
          d.appendChild(dv);
        }
        if (v) dv.textContent = v;
        break;
      }
    }
  }
}

const labels: string[] = [];
for (const el of [...m9.children]) {
  const t = local(el);
  if (t === 'direction') {
    const w = el.querySelector('wedge');
    labels.push(
      `wedge(${w?.getAttribute('type')}/pl=${el.getAttribute('placement')}/st=${el.querySelector('staff')?.textContent}/v=${el.querySelector('voice')?.textContent})`,
    );
  } else if (t === 'note') {
    const rest = !!el.querySelector('rest');
    const p =
      (el.querySelector('step')?.textContent || '') + (el.querySelector('octave')?.textContent || '');
    labels.push(`${rest ? 'REST' : p}(v=${el.querySelector('voice')?.textContent})`);
  } else if (t === 'backup' || t === 'forward') {
    labels.push(`${t}(${el.querySelector('duration')?.textContent})`);
  }
}
console.log(labels.join('\n'));

const hasStart = labels.some((l) => l.includes('wedge(diminuendo'));
const hasStop = labels.some((l) => l.includes('wedge(stop'));
const stopVoice = labels.find((l) => l.includes('wedge(stop'));
if (!hasStart || !hasStop) {
  console.error('FAIL missing wedge after pipeline');
  process.exit(1);
}
if (stopVoice && !stopVoice.includes('/v=2')) {
  console.error('FAIL stop voice should be 2 (same as A2/E2 layer)', stopVoice);
  process.exit(1);
}
const startI = labels.findIndex((l) => l.includes('wedge(diminuendo'));
const stopI = labels.findIndex((l) => l.includes('wedge(stop'));
if (startI > stopI) {
  console.error('FAIL start after stop');
  process.exit(1);
}
fs.writeFileSync('_smoke/_b02f_pl_m9_out.xml', serializeMusicXmlDocument(doc));
console.log('pipeline wedges ok');
