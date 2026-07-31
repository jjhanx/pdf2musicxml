/**
 * GraphicSheet note dump for P1 m1-28 after cleanup.
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

function p1Only(xml: string, max = 28, cleanup = false): string {
  let out = xml;
  if (cleanup) {
    out = repairRestDisplayForOsmdPreview(out);
    out = repairTimelineForOsmdPreview(out);
  }
  const doc = parseMusicXmlDocument(out);
  if (!doc) throw new Error('parse');
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    if (part.getAttribute('id') !== 'P1') part.parentNode?.removeChild(part);
    else {
      for (const child of [...part.children]) {
        if (local(child) !== 'measure') continue;
        if (parseInt(child.getAttribute('number') ?? '0', 10) > max) part.removeChild(child);
      }
    }
  }
  const partList = [...doc.documentElement.children].find((c) => local(c) === 'part-list');
  if (partList) {
    for (const sp of [...partList.children]) {
      if (local(sp) !== 'score-part') continue;
      if (sp.getAttribute('id') !== 'P1') partList.removeChild(sp);
    }
  }
  doc.querySelectorAll('octave-shift, *|octave-shift').forEach((el) => el.remove());
  return serializeMusicXmlDocument(doc);
}

function gmNumber(gm: Record<string, unknown>): number {
  return Number(gm.MeasureNumber ?? gm.measureNumber ?? gm.MeasureNumberXML ?? 0);
}

function gmNotes(gm: Record<string, unknown>): string[] {
  const out: string[] = [];
  const staffEntries = (gm.staffEntries ?? gm.StaffEntries ?? []) as Record<string, unknown>[];
  for (const se of staffEntries) {
    const gNotes = (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? se.graphNotes ?? []) as Record<
      string,
      unknown
    >[];
    for (const gve of gNotes) {
      const notes = (gve.notes ?? gve.Notes ?? [gve]) as Record<string, unknown>[];
      for (const n of notes) {
        const src = (n.sourceNote ?? n.SourceNote ?? n) as Record<string, unknown>;
        const pitch = src.Pitch ?? src.pitch;
        if (pitch && typeof pitch === 'object') {
          const p = pitch as Record<string, unknown>;
          out.push(String(p.fundamentalNote ?? p.FundamentalNote ?? '?') + String(p.octave ?? p.Octave ?? ''));
        }
      }
    }
  }
  return out;
}

async function run(label: string, cleanup: boolean) {
  try {
    const raw = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
    const xml = p1Only(raw, 28, cleanup);
    const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
    const host = document.getElementById('host') as HTMLDivElement;
    host.innerHTML = '';
    const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
    await osmd.load(xml);
    osmd.render();
    const gsheet = (osmd as unknown as Record<string, unknown>).GraphicSheet as { MeasureList?: Record<string, unknown>[] };
    const list = gsheet?.MeasureList ?? [];
    console.log(`\n${label} MeasureList=${list.length} nums=${list.slice(0, 5).map(gmNumber).join(',')} ... ${list.slice(-3).map(gmNumber).join(',')}`);
    for (const gm of list) {
      const n = gmNumber(gm);
      if (n < 25 || n > 27) continue;
      console.log(` m${n} keys=${Object.keys(gm).slice(0, 12).join(',')} notes=${gmNotes(gm)}`);
    }
  } catch (e) {
    console.log(`${label} ERROR`, e instanceof Error ? e.message : e);
  }
}

async function main() {
  await run('RAW', false);
  await run('CLEANED', true);
}

void main().catch(console.error);
