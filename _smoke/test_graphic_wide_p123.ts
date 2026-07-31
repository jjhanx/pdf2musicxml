/** Graphic layout m23-29 with wide host (autoResize) */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { forEachOsmdSystem, measureMxlFromGraphic } from '../src/osmdMeasureClick.ts';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
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
  osmd.zoom = 0.5;
  osmd.render();
  let sysIdx = 0;
  forEachOsmdSystem(osmd, (_s, rows) => {
    sysIdx += 1;
    const nums: number[] = [];
    for (const row of rows) {
      for (const gm of row) {
        const n = measureMxlFromGraphic(gm as Record<string, unknown>);
        if (n != null && n >= 23 && n <= 29) nums.push(n);
      }
    }
    if (nums.length) {
      console.log(`sys${sysIdx}`, [...new Set(nums)].sort((a, b) => a - b).join(','), 'cols', Math.max(...rows.map((r) => r.length)));
    }
  });
}

void main();
