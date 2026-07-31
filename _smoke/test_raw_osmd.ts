import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { forEachOsmdSystem, measureMxlFromGraphic, partIdFromGraphic } from '../src/osmdMeasureClick.ts';
import { stripChordBeamsForOsmdPreview, stripMeasureWidthAttributesForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:1800px;height:12000px"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document, window: dom.window, DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer, Node: dom.window.Node, Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement, SVGElement: dom.window.SVGElement,
  requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

async function main() {
  try {
    const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
    const host = document.getElementById('host') as HTMLDivElement;
    const osmd = new OpenSheetMusicDisplay(host, { autoResize: true, backend: 'svg' });
    let xml = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
    xml = stripMeasureWidthAttributesForOsmdPreview(xml);
    xml = stripChordBeamsForOsmdPreview(xml);
    await osmd.load(xml);
    osmd.render();
    let found26 = false;
    forEachOsmdSystem(osmd, (_s, rows) => {
      for (const row of rows) {
        if (!row) continue;
        for (const gm of row) {
          if (measureMxlFromGraphic(gm as Record<string, unknown>) === 26) found26 = true;
        }
      }
    });
    console.log('Measure 26 found in OSMD?', found26);
  } catch (e) {
    console.error('Error:', e);
  }
}
void main();
