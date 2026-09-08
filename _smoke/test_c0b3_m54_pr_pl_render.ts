/**
 * c0b3 m54 PR/PL 단일 마디 미리보기 렌더가 멈추지 않는지 확인.
 * Run: npx tsx _smoke/test_c0b3_m54_pr_pl_render.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
import {
  normalizeMultiVoiceLayersForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
  repairTimelineForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview as pruneStaff } from '../shared/musicXmlStaffPreview';
import {
  measureHasExplicitPlayOrder,
  measureHasMidClefAttributes,
  reorderMeasureNotesByPlayOrderForOsmdPreview,
} from '../shared/musicXmlPlayOrder';
import { anchorTrailingMidClefsInMeasure } from '../shared/musicXmlMidClefOsmdAnchor';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse';
import { filterMusicXmlToMeasureRange } from '../shared/musicXmlMeasureRange';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => any }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => any } }).default
    ?.OpenSheetMusicDisplay;
if (!OSMD) throw new Error('OSMD missing');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  SVGElement: dom.window.SVGElement,
});

function local(el: Element): string {
  return el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
}

function noteStaffN(note: Element): number {
  const t = [...note.children].find((c) => local(c) === 'staff')?.textContent?.trim();
  return parseInt(t || '1', 10) || 1;
}

function filterPartStaff(xml: string, partId: string, staffN: number): string {
  const doc = parseMusicXmlDocument(xml)!;
  for (const part of [...doc.getElementsByTagName('part')]) {
    if (part.getAttribute('id') !== partId) {
      part.remove();
      continue;
    }
    for (const measure of [...part.children].filter((c) => local(c) === 'measure')) {
      for (const child of [...measure.children]) {
        if (local(child) === 'note' && noteStaffN(child) !== staffN) child.remove();
      }
      pruneStaff(measure, staffN);
      snapshotNoteDefaultXForOsmdPreview(measure);
      reorderMeasureNotesByPlayOrderForOsmdPreview(measure);
      if (!measureHasExplicitPlayOrder(measure, staffN) && !measureHasMidClefAttributes(measure, staffN)) {
        reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
      }
      normalizeMultiVoiceLayersForOsmdPreview(measure);
      realignMeasureDefaultXFromTimelineForOsmd(measure);
      measure.querySelectorAll('note staff, note *|staff').forEach((el) => {
        el.textContent = '1';
      });
      anchorTrailingMidClefsInMeasure(measure);
    }
  }
  const partList = doc.getElementsByTagName('part-list')[0];
  if (partList) {
    for (const sp of [...partList.children]) {
      if (local(sp) === 'score-part' && sp.getAttribute('id') !== partId) sp.remove();
    }
  }
  return serializeMusicXmlDocument(doc);
}

async function renderOne(label: string, xml: string): Promise<void> {
  const start = performance.now();
  const host = document.createElement('div');
  host.style.width = '1200px';
  document.body.appendChild(host);
  const osmd = new OSMD(host, { autoResize: false, backend: 'svg', drawTitle: false });
  const loadStart = performance.now();
  console.log(`${label} start`, {
    notes: (xml.match(/<note[\s>]/g) || []).length,
    backups: (xml.match(/<backup[\s>]/g) || []).length,
    forwards: (xml.match(/<forward[\s>]/g) || []).length,
    voices: [...new Set([...xml.matchAll(/<voice>([^<]+)/g)].map((m) => m[1]))].join(','),
  });
  await osmd.load(xml);
  const renderStart = performance.now();
  osmd.render();
  const end = performance.now();
  if (!host.querySelector('svg')) throw new Error(`${label}: no SVG rendered`);
  host.remove();
  console.log(`${label} timings`, {
    loadMs: Math.round(renderStart - loadStart),
    renderMs: Math.round(end - renderStart),
    totalMs: Math.round(end - start),
    notes: (xml.match(/<note[\s>]/g) || []).length,
    backups: (xml.match(/<backup[\s>]/g) || []).length,
    forwards: (xml.match(/<forward[\s>]/g) || []).length,
  });
}

const path = '_smoke/_c0b3_score.xml';
if (!existsSync(path)) {
  console.log('skip: no _smoke/_c0b3_score.xml');
  process.exit(0);
}

let raw = readFileSync(path, 'utf8');
for (const [start, end] of [
  [55, 55],
  [51, 58],
] as const) {
  const slice = filterMusicXmlToMeasureRange(raw, start, end);
  await renderOne(`m${start}-${end} PR`, repairTimelineForOsmdPreview(filterPartStaff(slice, 'P5', 1), { faithfulEditorLayout: true }));
}

console.log('c0b3 m54 PR/PL render ok');
