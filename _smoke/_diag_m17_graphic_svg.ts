/** Graphical-layer SVG access on m17 slice */
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
import {
  repairTimelineForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
import { forEachGraphicalMeasure, measureMxlFromGraphic } from '../src/osmdMeasureClick';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="h"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document, window: dom.window, DOMParser: dom.window.DOMParser,
  Node: dom.window.Node, Element: dom.window.Element,
  requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});
const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function buildM17Slice(raw: string): string {
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
    snapshotNoteDefaultXForOsmdPreview(measure);
    reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
    normalizeMultiVoiceLayersForOsmdPreview(measure);
    realignMeasureDefaultXFromTimelineForOsmd(measure);
  }
  const m17 = [...part.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === '17')!;
  return `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P5"><part-name/></score-part></part-list><part id="P5">${m17.outerHTML}</part></score-partwise>`;
}

async function main() {
  const raw = execSync('python _smoke/_export_m17_parallel_fix.py', { encoding: 'utf8', maxBuffer: 20e6 });
  const slice = buildM17Slice(raw);
  const host = document.getElementById('h')!;
  host.style.width = '900px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg' });
  await (osmd as { load: (x: string) => Promise<void> }).load(slice);
  (osmd as { render: () => void }).render();

  const rules = (osmd as { EngravingRules: { GNote: (n: unknown) => Record<string, unknown> } }).EngravingRules;
  console.log('vf-stavenote', host.querySelectorAll('.vf-stavenote').length);

  forEachGraphicalMeasure(osmd as never, (gm) => {
    if (measureMxlFromGraphic(gm) !== 17) return;
    const g = gm as Record<string, unknown>;
    for (const se of (g.staffEntries ?? g.StaffEntries ?? []) as Record<string, unknown>[]) {
      for (const gve of (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as Record<string, unknown>[]) {
        const pve = gve.parentVoiceEntry ?? gve.ParentVoiceEntry;
        const ts = (pve as Record<string, unknown>)?.Timestamp ?? (pve as Record<string, unknown>)?.timestamp;
        const tsVal = typeof ts === 'object' && ts ? (ts as Record<string, unknown>).RealValue : ts;
        if (Number(tsVal) !== 0.25) continue;
        for (const gnRaw of (gve.notes ?? gve.Notes ?? []) as Record<string, unknown>[]) {
          const gn = gnRaw;
          const srcGn = gn.sourceNote ? rules.GNote(gn.sourceNote) : gn;
          const pos = (srcGn.PositionAndShape ?? gn.PositionAndShape) as Record<string, unknown> | undefined;
          if (pos?.calculateAbsolutePosition) (pos.calculateAbsolutePosition as () => void)();
          const absX = (pos?.AbsolutePosition as Record<string, unknown>)?.x;
          const svgGve = typeof gn.getSVGGElement === 'function' ? gn.getSVGGElement() : null;
          let screenX = '?';
          let tr = '';
          if (svgGve) {
            tr = svgGve.getAttribute('transform') ?? '';
            try {
              const bb = svgGve.getBBox();
              screenX = String(Math.round((bb.x + bb.width / 2) * 100) / 100);
            } catch { /* */ }
          }
          console.log(`ts=${tsVal} absX=${absX} svgX=${screenX} tr=${tr.slice(0, 50)}`);
        }
      }
    }
  });

  console.log('\nall vf-stavenote transforms:');
  for (const n of host.querySelectorAll('.vf-stavenote')) {
    const tr = n.getAttribute('transform') ?? '';
    const m = /translate\(\s*([-\d.]+)/.exec(tr);
    console.log(' ', m ? parseFloat(m[1]!) : '?', tr.slice(0, 55));
  }
  console.log('\nnotehead x attrs:');
  for (const h of host.querySelectorAll('.vf-notehead')) {
    console.log(' ', h.getAttribute('x'), h.getAttribute('y'), h.parentElement?.tagName);
  }
}

main().catch(console.error);
