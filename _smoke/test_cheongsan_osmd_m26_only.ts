/**
 * OSMD m26 render test without AudiverisInspectPanel imports.
 * Run: npx tsx _smoke/test_cheongsan_osmd_m26_only.ts
 */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { removeDanglingTimelineElementsForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairRestDisplayForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';

const dom = new JSDOM(
  '<!DOCTYPE html><html><body><div id="host" style="width:1400px;height:8000px;position:relative"></div></body></html>',
);
const g = globalThis as unknown as Record<string, unknown>;
g.document = dom.window.document;
g.window = dom.window;
g.DOMParser = dom.window.DOMParser;
g.XMLSerializer = dom.window.XMLSerializer;
g.Node = dom.window.Node;
g.Element = dom.window.Element;
g.HTMLElement = dom.window.HTMLElement;
g.SVGElement = dom.window.SVGElement;
g.requestAnimationFrame = (cb: FrameRequestCallback) => {
  setTimeout(() => cb(0), 0);
  return 0;
};

function loadCheongsanXml(): string {
  return readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
}

function stripNewPage(xml: string): string {
  const doc = parseMusicXmlDocument(xml);
  if (!doc) return xml;
  const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
  doc.querySelectorAll('*').forEach((el) => {
    if (local(el) !== 'print') return;
    el.removeAttribute('new-page');
    if (!el.attributes.length && !el.children.length) el.remove();
  });
  return serializeMusicXmlDocument(doc);
}

function countGraphicM26(osmd: import('opensheetmusicdisplay').OpenSheetMusicDisplay): { total: number; empty: number } {
  const sheet = osmd.GraphicSheet as { MeasureList?: Array<{ MeasureNumber?: number; measureNumber?: number; staffEntries?: unknown[]; VerticalSourceStaffEntryContainers?: unknown[] }> } | undefined;
  const measures = (sheet?.MeasureList ?? []).filter((m) => Number(m.MeasureNumber ?? m.measureNumber) === 26);
  let total = 0;
  let empty = 0;
  for (const m of measures) {
    const entries = (m.staffEntries ?? m.VerticalSourceStaffEntryContainers ?? []) as unknown[];
    total += entries.length;
    if (entries.length === 0) empty += 1;
  }
  return { total, empty };
}

async function tryLoad(label: string, xml: string) {
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  host.innerHTML = '';
  const osmd = new OpenSheetMusicDisplay(host, {
    autoResize: false,
    backend: 'svg',
    drawTitle: false,
    drawComposer: false,
    drawMeasureNumbers: false,
  } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
  try {
    await osmd.load(xml);
    osmd.zoom = 0.4;
    osmd.render();
    const { total, empty } = countGraphicM26(osmd);
    console.log(label, { total, empty, measures26: (osmd.GraphicSheet as { MeasureList?: unknown[] })?.MeasureList?.length });
    if (empty > 0 || total < 4) throw new Error(`m26 render bad: total=${total} empty=${empty}`);
  } catch (e) {
    console.log(label, 'LOAD FAIL', e instanceof Error ? e.message : e);
    throw e;
  }
}

async function main() {
  const raw = loadCheongsanXml();
  let xml = raw;
  xml = repairRestDisplayForOsmdPreview(xml);
  xml = removeDanglingTimelineElementsForOsmdPreview(xml);
  await tryLoad('raw+cleanup', xml);
  await tryLoad('raw+cleanup+stripNewPage', stripNewPage(xml));
  console.log('ok');
}

void main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
