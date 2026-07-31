/**
 * Dump pitches from OSMD after P1+P2+P3 m1-28 load.
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

function prep(xml: string, cleanup: boolean): string {
  let out = xml;
  if (cleanup) out = repairTimelineForOsmdPreview(out);
  const doc = parseMusicXmlDocument(out);
  if (!doc) throw new Error('parse');
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    const pid = part.getAttribute('id') ?? '';
    if (!['P1', 'P2', 'P3'].includes(pid)) {
      part.parentNode?.removeChild(part);
      continue;
    }
    for (const child of [...part.children]) {
      if (local(child) !== 'measure') continue;
      const n = parseInt(child.getAttribute('number') ?? '0', 10);
      if (n > 28) part.removeChild(child);
    }
  }
  doc.querySelectorAll('octave-shift, *|octave-shift').forEach((el) => el.remove());
  return serializeMusicXmlDocument(doc);
}

function dumpMeasure(sm: Record<string, unknown>) {
  const num = sm.MeasureNumber ?? sm.measureNumber;
  console.log('SM', num, Object.keys(sm));
  const vc = sm.VerticalSourceStaffEntryContainers as unknown[] | undefined;
  console.log('  vc len', vc?.length);
  if (!vc?.length) return;
  const c0 = vc[0] as Record<string, unknown>;
  console.log('  c0 keys', Object.keys(c0));
  const se = c0.StaffEntries as unknown[] | undefined;
  console.log('  staffEntries len', se?.length);
  if (se?.[0]) console.log('  se0 keys', Object.keys(se[0] as object));
  if (se?.[0]) {
    const se0 = se[0] as Record<string, unknown>;
    console.log('  se0 sourceStaffEntry keys', se0.sourceStaffEntry && Object.keys(se0.sourceStaffEntry as object));
  }
}

async function main() {
  const raw = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  const xml = prep(raw, true);
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
  await osmd.load(xml);
  osmd.render();
  const sheet = (osmd as unknown as Record<string, unknown>).Sheet as { SourceMeasures?: Record<string, unknown>[] };
  console.log('source measures', sheet?.SourceMeasures?.length);
  for (const sm of sheet?.SourceMeasures ?? []) {
    const num = Number(sm.MeasureNumber ?? sm.measureNumber ?? 0);
    if (num >= 25 && num <= 27) dumpMeasure(sm);
  }
}

void main().catch(console.error);
