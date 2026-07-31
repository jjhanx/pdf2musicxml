/** Graphic m25-27 for P123 (no split) — same load as debug_m26_tostring */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { forEachOsmdSystem, measureMxlFromGraphic } from '../src/osmdMeasureClick.ts';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairRestDisplayForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:1400px;height:3000px"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.Element,
  SVGElement: dom.window.SVGElement,
  requestAnimationFrame: (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
    return 0;
  },
});

function load(raw: string, parts: string[]): string {
  let out = repairTimelineForOsmdPreview(repairRestDisplayForOsmdPreview(raw));
  const doc = parseMusicXmlDocument(out);
  if (!doc) throw new Error('parse');
  const keep = new Set(parts);
  for (const p of [...doc.querySelectorAll('part, *|part')]) {
    if (!keep.has(p.getAttribute('id') ?? '')) p.parentNode?.removeChild(p);
  }
  const pl = [...doc.documentElement.children].find(
    (c) => (c.localName?.toLowerCase() ?? c.tagName.toLowerCase()) === 'part-list',
  );
  if (pl) {
    for (const sp of [...pl.children]) {
      const tag = sp.localName?.toLowerCase() ?? sp.tagName.toLowerCase();
      if (tag === 'score-part' && !keep.has(sp.getAttribute('id') ?? '')) pl.removeChild(sp);
    }
  }
  doc.querySelectorAll('octave-shift, *|octave-shift').forEach((el) => el.remove());
  return serializeMusicXmlDocument(doc);
}

async function main() {
  const raw = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  const xml = load(raw, ['P1', 'P2', 'P3']);
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: true, backend: 'svg' } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
  await osmd.load(xml);
  osmd.zoom = 0.45;
  osmd.render();
  forEachOsmdSystem(osmd, (_s, rows) => {
    let maxMi = 0;
    const numsInSystem = new Set<number>();
    for (const row of rows) {
      maxMi = Math.max(maxMi, row.length);
      for (const gm of row) {
        const n = measureMxlFromGraphic(gm as Record<string, unknown>);
        if (n != null && n >= 23 && n <= 29) numsInSystem.add(n);
      }
    }
    if (numsInSystem.size) {
      console.log('system measures', [...numsInSystem].sort((a, b) => a - b).join(','), 'cols', maxMi);
    }
  });
}

void main().catch(console.error);
