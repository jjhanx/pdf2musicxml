/**
 * After successful P1+P2+P3 load, dump m25-27 note pitches from OSMD Sheet.
 */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairRestDisplayForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
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

function filterParts(xml: string, partIds: string[], maxMeasure = 28, cleanup = true): string {
  let out = xml;
  if (cleanup) {
    out = repairRestDisplayForOsmdPreview(out);
    out = repairTimelineForOsmdPreview(out);
  }
  const doc = parseMusicXmlDocument(out);
  if (!doc) throw new Error('parse fail');
  const keep = new Set(partIds);
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    const pid = part.getAttribute('id') ?? '';
    if (!keep.has(pid)) {
      part.parentNode?.removeChild(part);
      continue;
    }
    for (const child of [...part.children]) {
      if (local(child) !== 'measure') continue;
      const n = parseInt(child.getAttribute('number') ?? '0', 10);
      if (n > maxMeasure) part.removeChild(child);
    }
  }
  const partList = [...doc.documentElement.children].find((c) => local(c) === 'part-list');
  if (partList) {
    for (const sp of [...partList.children]) {
      if (local(sp) !== 'score-part') continue;
      if (!keep.has(sp.getAttribute('id') ?? '')) partList.removeChild(sp);
    }
  }
  doc.querySelectorAll('octave-shift, *|octave-shift').forEach((el) => el.remove());
  return serializeMusicXmlDocument(doc);
}

function collectNotes(sm: Record<string, unknown>): string[] {
  const out: string[] = [];
  const walk = (obj: unknown, depth = 0): void => {
    if (!obj || depth > 8) return;
    if (Array.isArray(obj)) {
      for (const x of obj) walk(x, depth + 1);
      return;
    }
    if (typeof obj !== 'object') return;
    const rec = obj as Record<string, unknown>;
    if ('fundamentalNote' in rec && 'octave' in rec) {
      const step = rec.fundamentalNote;
      const oct = rec.octave;
      out.push(`${step}${oct}`);
      return;
    }
    if (rec.Pitch && typeof rec.Pitch === 'object') {
      walk(rec.Pitch, depth + 1);
      return;
    }
    if (rec.sourceNote && typeof rec.sourceNote === 'object') {
      walk(rec.sourceNote, depth + 1);
      return;
    }
    for (const v of Object.values(rec)) {
      if (v && typeof v === 'object') walk(v, depth + 1);
    }
  };
  walk(sm);
  return out;
}

async function loadAndDump(label: string, xml: string) {
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  host.innerHTML = '';
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
  await osmd.load(xml);
  osmd.render();
  const sheet = (osmd as unknown as Record<string, unknown>).Sheet as { SourceMeasures?: Record<string, unknown>[] };
  console.log(`\n${label} loaded, measures=${sheet?.SourceMeasures?.length}`);
  for (const sm of sheet?.SourceMeasures ?? []) {
    const num = Number(sm.MeasureNumber ?? sm.measureNumber ?? 0);
    if (num < 25 || num > 27) continue;
    const notes = collectNotes(sm);
    console.log(` m${num}`, notes.slice(0, 20));
  }
}

async function main() {
  const raw = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  await loadAndDump('CLEANED', filterParts(raw, ['P1', 'P2', 'P3'], 28, true));
  await loadAndDump('RAW dangling', filterParts(raw, ['P1', 'P2', 'P3'], 28, false));
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
