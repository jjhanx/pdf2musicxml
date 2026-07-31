/** Compare graphic m23-29: partial vs full print strip */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { forEachOsmdSystem, measureMxlFromGraphic } from '../src/osmdMeasureClick.ts';
import {
  repairTimelineForOsmdPreview,
  stripPageBreakPrintForOsmdPreview,
  stripNewSystemPrintForOsmdPreview,
  removeDanglingTimelineElementsForOsmdPreview,
} from '../shared/musicXmlTimelineCleanup.ts';
import { repairRestDisplayForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:1800px;height:4000px"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  SVGElement: dom.window.SVGElement,
  requestAnimationFrame: (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
    return 0;
  },
});

function p123(raw: string, timeline: (x: string) => string): string {
  let out = timeline(repairRestDisplayForOsmdPreview(raw));
  const doc = parseMusicXmlDocument(out);
  if (!doc) throw new Error('parse');
  for (const p of [...doc.querySelectorAll('part, *|part')]) {
    if (!['P1', 'P2', 'P3'].includes(p.getAttribute('id') ?? '')) p.parentNode?.removeChild(p);
  }
  doc.querySelectorAll('octave-shift, *|octave-shift').forEach((el) => el.remove());
  return serializeMusicXmlDocument(doc);
}

function oldTimeline(xml: string): string {
  let out = removeDanglingTimelineElementsForOsmdPreview(xml);
  out = stripPageBreakPrintForOsmdPreview(out);
  out = stripNewSystemPrintForOsmdPreview(out);
  return out;
}

async function layout(label: string, xml: string) {
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  host.innerHTML = '';
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: true, backend: 'svg' } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
  await osmd.load(xml);
  osmd.zoom = 0.5;
  osmd.render();
  const rows: string[] = [];
  forEachOsmdSystem(osmd, (_s, rws) => {
    const nums: number[] = [];
    for (const row of rws) {
      for (const gm of row) {
        const n = measureMxlFromGraphic(gm as Record<string, unknown>);
        if (n != null && n >= 23 && n <= 29) nums.push(n);
      }
    }
    if (nums.length) rows.push([...new Set(nums)].sort((a, b) => a - b).join(','));
  });
  console.log(label, 'systems', rows.length, rows.slice(-7).join(' | '));
}

async function main() {
  const raw = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  await layout('OLD partial strip', p123(raw, oldTimeline));
  await layout('NEW full strip', p123(raw, repairTimelineForOsmdPreview));
}

void main();
