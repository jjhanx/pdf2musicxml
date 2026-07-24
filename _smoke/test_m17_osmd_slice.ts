/** Load P5-only m17 slice in OSMD and compare F4 vs E5 graphic X. */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
import {
  repairTimelineForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  mergeSameOnsetVoicesForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';

const OSMD = (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay
  ?? (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="h"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document, window: dom.window, DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer, Node: dom.window.Node, Element: dom.window.Element,
  requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});
const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function buildP5M17(raw: string): string {
  let xml = repairTimelineForOsmdPreview(raw);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
  for (const measure of [...part.children]) {
    if (local(measure) !== 'measure') continue;
    for (const child of [...measure.children]) {
      if (local(child) === 'note') {
        const st = child.querySelector('staff,*|staff')?.textContent?.trim();
        if (st && st !== '1') child.remove();
      }
    }
    measure.querySelectorAll('note staff,note *|staff').forEach((el) => { el.textContent = '1'; });
    pruneCrossStaffTimelineForOsmdPreview(measure, 1);
    reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
    normalizeMultiVoiceLayersForOsmdPreview(measure);
    mergeSameOnsetVoicesForOsmdPreview(measure);
    realignMeasureDefaultXFromTimelineForOsmd(measure);
  }
  const m17 = [...part.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === '17')!;
  const slice = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P5"><part-name>Piano</part-name></score-part></part-list><part id="P5">${m17.outerHTML}</part></score-partwise>`;
  return repairTimelineForOsmdPreview(slice);
}

async function main() {
  const raw = execSync('python _smoke/_export_m17_parallel_fix.py', { encoding: 'utf8', maxBuffer: 20e6 });
  const xml = buildP5M17(raw);
  fs.writeFileSync('_smoke/_m17_p5_only.xml', xml);

  const host = document.getElementById('h')!;
  host.style.width = '900px';
  host.style.height = '400px';
  const osmd = new OSMD!(host, { autoResize: false, backend: 'svg' });
  await (osmd as { load: (x: string) => Promise<void> }).load(xml);
  (osmd as { render: () => void }).render();

  const g = osmd as Record<string, unknown>;
  const sheet = (g.GraphicSheet ?? g.graphic) as Record<string, unknown> | undefined;
  const list = (sheet?.MeasureList ?? sheet?.measureList ?? []) as Record<string, unknown>[];
  const m = list[0];
  console.log('measure keys', m ? Object.keys(m).slice(0, 15) : 'none');
  const xs: Record<string, number[]> = {};
  for (const se of (m?.staffEntries ?? m?.StaffEntries ?? []) as Record<string, unknown>[]) {
    const pos = (se.PositionAndShape ?? se.positionAndShape) as Record<string, unknown> | undefined;
    const rel = (pos?.RelativePosition ?? pos?.relativePosition) as Record<string, unknown> | undefined;
    const x = Number(rel?.x ?? rel?.X);
    for (const gve of (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as Record<string, unknown>[]) {
      for (const n of (gve.notes ?? gve.Notes ?? []) as Record<string, unknown>[]) {
        const src = (n.sourceNote ?? n.SourceNote) as Record<string, unknown>;
        const pitch = src?.Pitch ?? src?.pitch;
        if (pitch && typeof pitch === 'object') {
          const p = pitch as Record<string, unknown>;
          const label = String(p.fundamentalNote ?? p.FundamentalNote) + String(p.octave ?? p.Octave);
          (xs[label] ??= []).push(x);
        }
      }
    }
  }
  console.log('OSMD m17-only X:', xs);
  const f4 = xs.F4?.[0], e5 = xs.E5?.[0];
  console.log('F4-E5 delta:', f4 != null && e5 != null ? f4 - e5 : 'missing');
}

main().catch((e) => { console.error(e); process.exit(1); });
