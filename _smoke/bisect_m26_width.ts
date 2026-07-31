/** Bisect m26 negative width: split vs no split, part subsets */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';
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

function prep(raw: string, split: boolean, keep?: string[]): string {
  let xml = repairMissingNoteTypesForOsmdPreview(repairTimelineForOsmdPreview(raw));
  if (split) {
    const doc = parseMusicXmlDocument(xml)!;
    const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
    const p5 = doc.querySelector('part[id="P5"], *|part[id="P5"]');
    if (p5) {
      // minimal split stub - skip for bisect use build from test file
    }
    xml = serializeMusicXmlDocument(doc);
  }
  if (keep) {
    const doc = parseMusicXmlDocument(xml)!;
    const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
    const set = new Set(keep);
    for (const p of [...doc.querySelectorAll('part, *|part')]) {
      if (!set.has(p.getAttribute('id') ?? '')) p.parentNode?.removeChild(p);
    }
    const pl = [...doc.documentElement.children].find((c) => local(c) === 'part-list');
    if (pl) {
      for (const sp of [...pl.children]) {
        if (local(sp) === 'score-part' && !set.has(sp.getAttribute('id') ?? '')) pl.removeChild(sp);
      }
    }
    xml = serializeMusicXmlDocument(doc);
  }
  return xml;
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
  try {
    await osmd.load(xml);
  } catch (e) {
    console.log(label, 'LOAD FAIL', e instanceof Error ? e.message : e);
    return;
  }
  osmd.render();
  const sheet = (osmd as unknown as Record<string, unknown>).GraphicSheet as { MeasureList?: Record<string, unknown>[][] };
  let w = 0;
  for (const row of sheet?.MeasureList ?? []) {
    if (!row) continue;
    for (const gm of row) {
      if (!gm) continue;
      if (measureMxlFromGraphic(gm as Record<string, unknown>) === 26) {
        w = readW(gm as Record<string, unknown>);
        break;
      }
    }
  }
  console.log(label, 'm26 w', w);
}

async function main() {
  const raw = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  await probe('P1 only', prep(raw, false, ['P1']));
  await probe('P123', prep(raw, false, ['P1', 'P2', 'P3']));
  await probe('P5 only', prep(raw, false, ['P5']));
  await probe('full no split', prep(raw, false));
}

void main();
