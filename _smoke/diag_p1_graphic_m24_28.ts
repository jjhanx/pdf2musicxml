import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';
import { measureMxlFromGraphic, forEachOsmdSystem } from '../src/osmdMeasureClick.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:1400px;height:4000px"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document, window: dom.window, DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer, Node: dom.window.Node, Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement, requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

function local(el: Element) { return el.localName?.toLowerCase() ?? el.tagName.toLowerCase(); }

function p1slice(raw: string): string {
  const doc = parseMusicXmlDocument(raw)!;
  const p1 = [...doc.querySelectorAll('part')].find(p => p.getAttribute('id') === 'P1')!;
  for (const c of [...p1.children]) if (local(c) === 'measure' && parseInt(c.getAttribute('number') ?? '0', 10) > 28) p1.removeChild(c);
  const root = parseMusicXmlDocument('<?xml version="1.0"?><score-partwise version="3.0"><part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list></score-partwise>')!;
  root.documentElement.appendChild(p1.cloneNode(true));
  return serializeMusicXmlDocument(root);
}

function readW(gm: Record<string, unknown>): number {
  const bb = gm.PositionAndShape ?? gm.positionAndShape;
  const size = (bb as Record<string, unknown>)?.Size ?? (bb as Record<string, unknown>)?.size;
  return Number((size as Record<string, unknown>)?.width ?? (size as Record<string, unknown>)?.Width ?? 0);
}

function firstWrittenPitch(gm: Record<string, unknown>): string {
  const entries = (gm.staffEntries ?? gm.StaffEntries) as unknown[] | undefined;
  for (const entry of entries ?? []) {
    const er = entry as Record<string, unknown>;
    const gves = (er.graphicalVoiceEntries ?? er.GraphicalVoiceEntries) as unknown[] | undefined;
    for (const gve of gves ?? []) {
      const gr = gve as Record<string, unknown>;
      const notes = (gr.notes ?? gr.Notes) as unknown[] | undefined;
      for (const note of notes ?? []) {
        const nr = note as Record<string, unknown>;
        const src = (nr.sourceNote ?? nr.SourceNote) as Record<string, unknown> | undefined;
        const pitch = (src?.Pitch ?? src?.pitch) as Record<string, unknown> | undefined;
        if (!pitch) continue;
        const written = pitch.writtenPitch ?? pitch.WrittenPitch ?? pitch;
        const fn = Number((written as Record<string, unknown>).FundamentalNote ?? pitch.FundamentalNote);
        const oct = Number((written as Record<string, unknown>).Octave ?? pitch.Octave);
        const names = ['C','D','E','F','G','A','B'];
        return `${names[fn] ?? fn}${oct}`;
      }
    }
  }
  return '?';
}

async function main() {
  const xml = p1slice(readFileSync('_smoke/_cheongsan_review.xml', 'utf8'));
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const osmd = new OpenSheetMusicDisplay(document.getElementById('host')!, { autoResize: true, backend: 'svg' });
  await osmd.load(xml);
  osmd.zoom = 0.35;
  osmd.render();
  forEachOsmdSystem(osmd, (_sys, rows) => {
    const row = rows[0] ?? [];
    console.log('graphic cells', row.length);
    for (let mi = 0; mi < row.length; mi++) {
      const gm = row[mi] as Record<string, unknown>;
      if (!gm) continue;
      const n = measureMxlFromGraphic(gm);
      if (n == null || n < 24 || n > 28) continue;
      console.log(`idx${mi} mxl${n} w=${readW(gm).toFixed(2)} pitch=${firstWrittenPitch(gm)} extra=${Boolean(gm.IsExtraGraphicalMeasure ?? gm.isExtraGraphicalMeasure)}`);
    }
  });
}
void main();
