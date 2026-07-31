/**
 * P1-only m24-28 after full preview pipeline — OSMD graphic widths + first pitch.
 */
import { readFileSync, writeFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd.ts';
import { repairRestDisplayForOsmdPreview, repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';
import { measureMxlFromGraphic } from '../src/osmdMeasureClick.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:1800px;height:4000px"></div></body></html>');
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

function local(el: Element): string {
  return el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
}

function prep(raw: string, partIds: string[], maxM: number): string {
  let xml = repairTimelineForOsmdPreview(raw);
  xml = repairUnderfullMeasuresForOsmdPreview(xml);
  xml = repairRestDisplayForOsmdPreview(xml);
  xml = repairMissingNoteTypesForOsmdPreview(xml);
  xml = repairTimelineForOsmdPreview(xml);
  const doc = parseMusicXmlDocument(xml)!;
  const keep = new Set(partIds);
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    if (!keep.has(part.getAttribute('id') ?? '')) part.parentNode?.removeChild(part);
    else {
      for (const c of [...part.children]) {
        if (local(c) !== 'measure') continue;
        if (parseInt(c.getAttribute('number') ?? '0', 10) > maxM) part.removeChild(c);
      }
    }
  }
  const pl = [...doc.documentElement.children].find((c) => local(c) === 'part-list');
  if (pl) {
    for (const sp of [...pl.children]) {
      if (local(sp) === 'score-part' && !keep.has(sp.getAttribute('id') ?? '')) pl.removeChild(sp);
    }
  }
  doc.querySelectorAll('octave-shift, *|octave-shift').forEach((el) => el.remove());
  return serializeMusicXmlDocument(doc);
}

function readW(gm: Record<string, unknown>): number {
  const bb = gm.PositionAndShape ?? gm.positionAndShape;
  const size = (bb as Record<string, unknown>)?.Size ?? (bb as Record<string, unknown>)?.size;
  return Number((size as Record<string, unknown>)?.width ?? (size as Record<string, unknown>)?.Width ?? 0);
}

function firstPitch(gm: Record<string, unknown>): string | null {
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
        const names = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
        const fn = pitch.FundamentalNote ?? pitch.fundamentalNote;
        const oct = pitch.Octave ?? pitch.octave;
        if (typeof fn === 'number' && typeof oct === 'number') return `${names[fn] ?? fn}${oct}`;
      }
    }
  }
  return null;
}

async function main() {
  const raw = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  const cases = [
    ['P1', ['P1']],
    ['P1-P4', ['P1', 'P2', 'P3', 'P4']],
    ['all-unsplit', ['P1', 'P2', 'P3', 'P4', 'P5']],
  ] as const;

  const results: string[] = [];
  for (const [label, parts] of cases) {
    const xml = prep(raw, [...parts], 28);
    writeFileSync(`_smoke/_probe_${label.replace(/[^a-z0-9]+/gi, '_')}.xml`, xml, 'utf8');
    const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
    const host = document.getElementById('host') as HTMLDivElement;
    host.innerHTML = '';
    const osmd = new OpenSheetMusicDisplay(host, { autoResize: true, backend: 'svg' });
    await osmd.load(xml);
    osmd.zoom = 0.42;
    osmd.render();
    const sheet = (osmd as unknown as Record<string, unknown>).GraphicSheet as { MeasureList?: Record<string, unknown>[][] };
    for (const row of sheet?.MeasureList ?? []) {
      for (const gm of row ?? []) {
        if (!gm) continue;
        const n = measureMxlFromGraphic(gm as Record<string, unknown>);
        if (n == null || n < 24 || n > 28) continue;
        const w = readW(gm as Record<string, unknown>);
        const p = firstPitch(gm as Record<string, unknown>);
        results.push(`${label} m${n} w=${w.toFixed(1)} pitch=${p}`);
      }
    }
  }
  writeFileSync('_smoke/_probe_m26_results.txt', results.join('\n') + '\n', 'utf8');
  console.log(results.join('\n'));
  const p1m26 = results.find((r) => r.startsWith('P1 m26'));
  if (!p1m26?.includes('pitch=F5')) throw new Error(`P1 m26 expected F5: ${p1m26}`);
}

void main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
