import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { measureMxlFromGraphic } from '../src/osmdMeasureClick.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:1800px;height:9000px"></div></body></html>');
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

function readW(gm: Record<string, unknown>): number {
  const bb = gm.PositionAndShape ?? gm.positionAndShape;
  const size = (bb as Record<string, unknown>)?.Size ?? (bb as Record<string, unknown>)?.size;
  return Number((size as Record<string, unknown>)?.width ?? (size as Record<string, unknown>)?.Width ?? 0);
}

async function main() {
  let xml = repairMissingNoteTypesForOsmdPreview(
    repairTimelineForOsmdPreview(readFileSync('_smoke/_cheongsan_review.xml', 'utf8')),
  );
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: true, backend: 'svg' });
  await osmd.load(xml);
  osmd.EngravingRules.FixedMeasureWidth = false;
  osmd.EngravingRules.FixedMeasureWidthFixedValue = 50;
  osmd.zoom = 0.42;
  osmd.render();

  const sheet = (osmd as unknown as Record<string, unknown>).GraphicSheet as {
    MeasureList?: Record<string, unknown>[][];
  };
  for (const row of sheet?.MeasureList ?? []) {
    for (const gm of row ?? []) {
      if (!gm) continue;
      const n = measureMxlFromGraphic(gm);
      if (n != null && n >= 24 && n <= 28) console.log('m', n, 'w', readW(gm).toFixed(2));
    }
  }
}

void main();
