import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { repairTimelineForOsmdPreview, stripChordBeamsForOsmdPreview } from './shared/musicXmlTimelineCleanup';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).navigator = dom.window.navigator;
(globalThis as any).DOMParser = dom.window.DOMParser;
(globalThis as any).XMLSerializer = dom.window.XMLSerializer;
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).HTMLDivElement = dom.window.HTMLDivElement;
(globalThis as any).HTMLCanvasElement = dom.window.HTMLCanvasElement;
(globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(() => cb(0), 0);

function m26EntryCount(osmd: any) {
  const gm = osmd.GraphicSheet?.MeasureList ?? [];
  let m26 = null;
  for (const m of gm) {
      if (m[0] && (m[0].MeasureNumber === 26 || m[0].measureNumber === 26)) {
          m26 = m;
          break;
      }
  }
  if (!m26) return { m26parts: 0, entries: 0, width: 0 };
  let n = 0;
  let w = m26[0].PositionAndShape?.Size?.width ?? 0;
  for (const partMeasure of m26) {
      n += (partMeasure.staffEntries ?? partMeasure.VerticalSourceStaffEntryContainers ?? []).length;
  }
  return { m26parts: m26.length, entries: n, width: w };
}

async function runCase(label: string, xml: string) {
  const host = dom.window.document.getElementById('host');
  const osmd = new OpenSheetMusicDisplay(host as any, {
    autoResize: false,
    backend: 'svg',
    drawTitle: false,
    drawComposer: false,
    drawMeasureNumbers: false,
  });
  osmd.setLogLevel('error');
  await osmd.load(xml);
  osmd.zoom = 0.35;
  osmd.render();
  const stats = m26EntryCount(osmd);
  console.log(label, stats);
}

async function main() {
  const rawXml = fs.readFileSync('C:/Users/jjhan/.gemini/antigravity-ide/brain/0009d072-c932-4a3d-8371-4463bfeebbbc/scratch/omr-work-0ea5ea52/audiveris_raw_mxl/clean_score_only.xml', 'utf8');
  
  // 1. apply front-end transformations
  let xml = repairTimelineForOsmdPreview(rawXml);
  xml = stripChordBeamsForOsmdPreview(xml);

  await runCase('front-end transformed XML', xml);
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
