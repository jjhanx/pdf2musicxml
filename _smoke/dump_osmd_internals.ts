/**
 * Dump OSMD internal structure after load.
 * Run: npx tsx _smoke/dump_osmd_internals.ts
 */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
const g = globalThis as unknown as Record<string, unknown>;
Object.assign(g, {
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

function local(el: Element): string {
  return el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
}

function sliceP1(xml: string, from: number, to: number): string {
  const doc = parseMusicXmlDocument(xml);
  if (!doc) throw new Error('parse');
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    if (part.getAttribute('id') !== 'P1') {
      part.parentNode?.removeChild(part);
      continue;
    }
    for (const child of [...part.children]) {
      if (local(child) !== 'measure') continue;
      const n = parseInt(child.getAttribute('number') ?? '0', 10);
      if (n < from || n > to) part.removeChild(child);
    }
  }
  return serializeMusicXmlDocument(doc);
}

function walk(obj: unknown, depth = 0, maxDepth = 4, seen = new WeakSet<object>()): void {
  if (depth > maxDepth || obj == null) return;
  if (typeof obj !== 'object') return;
  if (seen.has(obj as object)) return;
  seen.add(obj as object);
  const rec = obj as Record<string, unknown>;
  const keys = Object.keys(rec).filter((k) => !k.startsWith('_'));
  console.log('  '.repeat(depth) + keys.slice(0, 20).join(', '));
  if (Array.isArray(obj)) {
    if (obj.length > 0) walk(obj[0], depth + 1, maxDepth, seen);
    return;
  }
  for (const k of ['SourceMeasures', 'sourceMeasures', 'MeasureList', 'measureList', 'VerticalSourceStaffEntryContainers']) {
    if (k in rec) walk(rec[k], depth + 1, maxDepth, seen);
  }
}

async function main() {
  let xml = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  xml = repairTimelineForOsmdPreview(xml);
  xml = sliceP1(xml, 24, 28);

  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
  await osmd.load(xml);
  osmd.render();

  const raw = osmd as unknown as Record<string, unknown>;
  console.log('top keys', Object.keys(raw).filter((k) => /sheet|graphic|Sheet|Graphic/i.test(k)));
  const sheet = raw.Sheet ?? raw.sheet;
  console.log('\nSheet structure:');
  walk(sheet, 0, 5);
  const graphic = raw.GraphicSheet ?? raw.graphic;
  console.log('\nGraphicSheet structure:');
  walk(graphic, 0, 5);

  const sm = (sheet as { SourceMeasures?: unknown[] })?.SourceMeasures?.[0];
  console.log('\nFirst SourceMeasure keys', sm && typeof sm === 'object' ? Object.keys(sm as object) : sm);
  const measures = (sheet as { SourceMeasures?: unknown[] })?.SourceMeasures ?? [];
  for (const m of measures) {
    const rec = m as Record<string, unknown>;
    const num = rec.MeasureNumber ?? rec.measureNumber ?? rec.MeasureNumberXML ?? rec.MeasureNumberPrinted;
    console.log('measure', num, 'keys', Object.keys(rec).slice(0, 25));
    const vc = rec.VerticalSourceStaffEntryContainers ?? rec.verticalSourceStaffEntryContainers;
    if (Array.isArray(vc)) {
      console.log('  containers', vc.length);
      const first = vc[0] as Record<string, unknown> | undefined;
      if (first) console.log('  first container keys', Object.keys(first));
    }
  }
}

void main().catch(console.error);
