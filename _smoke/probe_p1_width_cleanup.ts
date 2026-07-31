import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairMissingNoteTypesForOsmdPreview, repairRestDisplayForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';
import { measureMxlFromGraphic, forEachOsmdSystem } from '../src/osmdMeasureClick.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:1800px;height:12000px"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document, window: dom.window, DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer, Node: dom.window.Node, Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement, requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

function local(el: Element) { return el.localName?.toLowerCase() ?? el.tagName.toLowerCase(); }
function readW(gm: Record<string, unknown>): number {
  const bb = gm.PositionAndShape ?? gm.positionAndShape;
  const size = (bb as Record<string, unknown>)?.Size ?? (bb as Record<string, unknown>)?.size;
  return Number((size as Record<string, unknown>)?.width ?? (size as Record<string, unknown>)?.Width ?? 0);
}

function p1m28(raw: string): string {
  const doc = parseMusicXmlDocument(raw)!;
  const p1 = [...doc.querySelectorAll('part')].find(p => p.getAttribute('id') === 'P1')!;
  for (const c of [...p1.children]) if (local(c) === 'measure' && parseInt(c.getAttribute('number') ?? '0', 10) > 28) p1.removeChild(c);
  const shell = parseMusicXmlDocument('<?xml version="1.0"?><score-partwise version="3.0"><part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list></score-partwise>')!;
  shell.documentElement.appendChild(p1.cloneNode(true));
  return serializeMusicXmlDocument(shell);
}

async function probe(label: string, xml: string) {
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host')!; host.innerHTML='';
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: true, backend: 'svg' });
  try {
    await osmd.load(xml);
    osmd.zoom = 0.35;
    osmd.render();
    const ws: string[] = [];
    forEachOsmdSystem(osmd, (_s, rows) => {
      for (const gm of rows[0] ?? []) {
        if (!gm) continue;
        const n = measureMxlFromGraphic(gm as Record<string, unknown>);
        if (n != null && n >= 24 && n <= 28) ws.push(`m${n}:${readW(gm as Record<string, unknown>).toFixed(1)}`);
      }
    });
    console.log(label, ws.join(' ') || 'none');
  } catch (e) {
    console.log(label, 'FAIL', e instanceof Error ? e.message : e);
  }
}

async function main() {
  const raw = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  await probe('raw', p1m28(raw));
  let x = repairTimelineForOsmdPreview(raw);
  await probe('+timeline', p1m28(x));
  x = repairMissingNoteTypesForOsmdPreview(x);
  await probe('+missingTypes', p1m28(x));
  x = repairRestDisplayForOsmdPreview(repairTimelineForOsmdPreview(raw));
  await probe('+restDisplay', p1m28(x));
  x = repairMissingNoteTypesForOsmdPreview(repairRestDisplayForOsmdPreview(repairTimelineForOsmdPreview(raw)));
  await probe('+all', p1m28(x));
}
void main();
