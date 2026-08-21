/**
 * After play-order align, sibling vf-stem/vf-beam must follow stavenotes.
 * Run: npx tsx _smoke/test_6497_align_beam_sync.ts
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { execSync } from 'node:child_process';
import {
  alignOsmdPreviewNotesByOnsetColumn,
  registerOsmdPreviewXmlForAlign,
} from '../src/osmdOnsetColumnAlignFix.ts';
import {
  repairTimelineForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
  stripDefaultXyKeepLayoutAttrsForOsmdPreview,
} from '../shared/musicXmlTimelineCleanup.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview.ts';

const require = createRequire(import.meta.url);
const { OpenSheetMusicDisplay } = require('opensheetmusicdisplay');

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="h"></div></body></html>', {
  pretendToBeVisual: true,
});
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
});

execSync('python _smoke/_dump_6497_m10.py', { stdio: 'pipe' });
let xml = fs.readFileSync('_smoke/_6497_review.xml', 'utf8');
xml = repairTimelineForOsmdPreview(xml);
const doc = parseMusicXmlDocument(xml)!;
const part = [...doc.querySelectorAll('part')].find((p) => p.getAttribute('id') === 'P5')!;
for (const m of [...part.children]) {
  if ((m.localName || '').toLowerCase() === 'measure' && m.getAttribute('number') !== '10') m.remove();
}
const m10 = [...part.children].find(
  (c) => (c.localName || '').toLowerCase() === 'measure' && c.getAttribute('number') === '10',
)! as Element;
for (const c of [...m10.children]) {
  if ((c.localName || '').toLowerCase() === 'note') {
    const st = parseInt(c.querySelector('staff')?.textContent || '1', 10);
    if (st !== 2) c.remove();
  }
}
pruneCrossStaffTimelineForOsmdPreview(m10, 2);
snapshotNoteDefaultXForOsmdPreview(m10);
reorderSingleStaffTimelineByOnsetForOsmdPreview(m10);
normalizeMultiVoiceLayersForOsmdPreview(m10);
realignMeasureDefaultXFromTimelineForOsmd(m10);
m10.querySelectorAll('staff').forEach((el) => {
  el.textContent = '1';
});

const out = parseMusicXmlDocument(`<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P5"><part-name>PL</part-name></score-part></part-list>
  <part id="P5"></part>
</score-partwise>`)!;
out.querySelector('part')!.appendChild(m10.cloneNode(true));
const measure = out.querySelector('measure')!;
let attrs = measure.querySelector('attributes');
if (!attrs) {
  attrs = out.createElement('attributes');
  measure.insertBefore(attrs, measure.firstChild);
}
if (!attrs.querySelector('divisions')) {
  const d = out.createElement('divisions');
  d.textContent = '24';
  attrs.appendChild(d);
}
if (!attrs.querySelector('clef')) {
  const clef = out.createElement('clef');
  const sign = out.createElement('sign');
  sign.textContent = 'F';
  const line = out.createElement('line');
  line.textContent = '4';
  clef.appendChild(sign);
  clef.appendChild(line);
  attrs.appendChild(clef);
}
const ser = stripDefaultXyKeepLayoutAttrsForOsmdPreview(serializeMusicXmlDocument(out));

const host = document.getElementById('h')!;
const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, drawTitle: false });
registerOsmdPreviewXmlForAlign(osmd, ser);
await osmd.load(ser);
osmd.render();

function beamPathXs(): number[] {
  const d = host.querySelector('.vf-beam path')?.getAttribute('d') || '';
  const xs: number[] = [];
  for (const m of d.matchAll(/[MmLl]\s*([-+]?\d+\.?\d*)/g)) xs.push(parseFloat(m[1]!));
  return xs;
}
function stemUserXs(): number[] {
  const outXs: number[] = [];
  for (const stem of host.querySelectorAll('.vf-measure > .vf-stem')) {
    const d = stem.querySelector('path')?.getAttribute('d') || '';
    const m = /^M\s*([-\d.]+)/.exec(d);
    if (!m) continue;
    const local = parseFloat(m[1]!);
    const tr = stem.getAttribute('transform') || '';
    const tm = /translate\(\s*([-\d.]+)/.exec(tr);
    const dx = tm ? parseFloat(tm[1]!) : 0;
    outXs.push(local + dx);
  }
  return outXs;
}

const beforeBeam = beamPathXs();
alignOsmdPreviewNotesByOnsetColumn(osmd);
const afterBeam = beamPathXs();
const stems = stemUserXs().sort((a, b) => a - b);
const beamLeft = Math.min(...afterBeam);
const beamRight = Math.max(...afterBeam);

if (stems.length < 2) throw new Error('expected sibling vf-stems for beamed notes');
if (Math.abs(beamLeft - beforeBeam[0]!) < 1 && Math.abs(stems[0]! - beforeBeam[0]!) > 20) {
  throw new Error('beam path did not move with stems');
}
const leftStem = stems[0]!;
const rightStem = stems[stems.length - 1]!;
if (Math.abs(beamLeft - leftStem) > 8) {
  throw new Error(`beam left ${beamLeft} far from stem ${leftStem}`);
}
if (Math.abs(beamRight - rightStem) > 8) {
  throw new Error(`beam right ${beamRight} far from stem ${rightStem}`);
}
console.log('OK align beam sync', { beamLeft, beamRight, leftStem, rightStem, beforeBeam: beforeBeam[0] });
