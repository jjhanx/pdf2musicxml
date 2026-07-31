import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import {
  repairTimelineForOsmdPreview,
  removeDanglingTimelineElementsForOsmdPreview,
  stripPrintElementsForOsmdPreview,
  stripMeasureWidthAttributesForOsmdPreview,
  stripDefaultXyForOsmdPreview,
  stripChordBeamsForOsmdPreview,
} from '../shared/musicXmlTimelineCleanup.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';
import { measureMxlFromGraphic } from '../src/osmdMeasureClick.ts';

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

function p1only(raw: string): string {
  const doc = parseMusicXmlDocument(raw)!;
  const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
  for (const p of [...doc.querySelectorAll('part, *|part')]) {
    if (p.getAttribute('id') !== 'P1') p.parentNode?.removeChild(p);
    else {
      for (const c of [...p.children]) {
        if (local(c) !== 'measure') continue;
        if (parseInt(c.getAttribute('number') ?? '0', 10) > 28) p.removeChild(c);
      }
    }
  }
  return serializeMusicXmlDocument(doc);
}

function readW(gm: Record<string, unknown>): number {
  const bb = gm.PositionAndShape ?? gm.positionAndShape;
  const size = (bb as Record<string, unknown>)?.Size ?? (bb as Record<string, unknown>)?.size;
  return Number((size as Record<string, unknown>)?.width ?? (size as Record<string, unknown>)?.Width ?? 0);
}

async function probe(label: string, xml: string) {
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  host.innerHTML = '';
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: true, backend: 'svg' } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
  await osmd.load(xml);
  osmd.render();
  const sheet = (osmd as unknown as Record<string, unknown>).GraphicSheet as { MeasureList?: Record<string, unknown>[][] };
  const ws: string[] = [];
  for (const row of sheet?.MeasureList ?? []) {
    if (!row?.[0]) continue;
    const gm = row[0] as Record<string, unknown>;
    const n = measureMxlFromGraphic(gm);
    if (n != null && n >= 24 && n <= 28) ws.push(`${n}:${readW(gm).toFixed(1)}`);
  }
  console.log(label, ws.join(' '));
}

async function main() {
  const raw = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  const base = p1only(raw);
  await probe('raw', base);
  let x = base;
  x = removeDanglingTimelineElementsForOsmdPreview(x);
  await probe('+dangling', x);
  x = stripPrintElementsForOsmdPreview(x);
  await probe('+print', x);
  x = stripMeasureWidthAttributesForOsmdPreview(x);
  await probe('+width', x);
  x = stripDefaultXyForOsmdPreview(x);
  await probe('+defaultxy', x);
  x = stripChordBeamsForOsmdPreview(x);
  await probe('+chordbeams', x);
  await probe('full repair', repairTimelineForOsmdPreview(base));
}

void main();
