/** Diagnose align target collection: GNote vs graphical layer */
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
import {
  repairTimelineForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
  collectLinkedParallelOnsetHintsFromXml,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
import { alignLinkedParallelOnsetGraphics } from '../src/osmdLinkedParallelAlignFix';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="h"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document, window: dom.window, DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer, Node: dom.window.Node, Element: dom.window.Element,
  requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});
const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function buildFullPr(raw: string): string {
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
  return repairTimelineForOsmdPreview(new XMLSerializer().serializeToString(doc));
}

async function main() {
  const raw = execSync('python _smoke/_export_m17_parallel_fix.py', { encoding: 'utf8', maxBuffer: 20e6 });
  const xml = buildFullPr(raw);
  const hints = collectLinkedParallelOnsetHintsFromXml(xml).filter((h) => h.measureNumber === 17);
  console.log('hints', hints);

  const host = document.getElementById('h')!;
  host.style.width = '1200px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg' });
  await (osmd as { load: (x: string) => Promise<void> }).load(xml);
  (osmd as { render: () => void }).render();

  const rules = (osmd as { EngravingRules: { GNote: (n: unknown) => Record<string, unknown> } }).EngravingRules;
  let srcSvgCount = 0;
  let gveSvgCount = 0;
  const vfNotes = host.querySelectorAll('.vf-stavenote');
  console.log('vf-stavenote count', vfNotes.length);

  const sheet = (osmd as unknown as { Sheet: { SourceMeasures: Record<string, unknown>[] } }).Sheet;
  for (const sm of sheet.SourceMeasures) {
    if (Number(sm.MeasureNumberXML) !== 17) continue;
    for (const vc of (sm.VerticalSourceStaffEntryContainers ?? []) as Record<string, unknown>[]) {
      const t = Number((vc.Timestamp as Record<string, unknown>)?.RealValue);
      if (Math.abs(t - 0.25) > 0.001) continue;
      for (const se of (vc.StaffEntries ?? []) as Record<string, unknown>[]) {
        if (!se) continue;
        for (const ve of (se.VoiceEntries ?? []) as Record<string, unknown>[]) {
          const voice = (ve.ParentVoice as Record<string, unknown>)?.VoiceId;
          for (const n of (ve.Notes ?? []) as Record<string, unknown>[]) {
            const gn = rules.GNote(n);
            const hasSvg = typeof (gn as { getSVGGElement?: unknown }).getSVGGElement === 'function';
            const svg = hasSvg ? (gn as { getSVGGElement: () => SVGElement | null }).getSVGGElement() : null;
            if (svg) srcSvgCount++;
            console.log(`src v=${voice} ht=${n.halfTone} GNote.svg=${!!svg} absX=${(gn.PositionAndShape as Record<string, unknown>)?.AbsolutePosition}`);
          }
        }
      }
    }
  }

  const graphic = (osmd as unknown as { graphic: { MeasureList: unknown[] } }).graphic;
  for (const row of graphic?.MeasureList ?? []) {
    if (!Array.isArray(row)) continue;
    for (const gm of row as Record<string, unknown>[]) {
      const sm = gm.parentSourceMeasure ?? gm.ParentSourceMeasure;
      if (Number((sm as Record<string, unknown>)?.MeasureNumberXML) !== 17) continue;
      for (const se of (gm.staffEntries ?? gm.StaffEntries ?? []) as Record<string, unknown>[]) {
        for (const gve of (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as Record<string, unknown>[]) {
          const pve = gve.parentVoiceEntry ?? gve.ParentVoiceEntry;
          const ts = Number((pve as Record<string, unknown>)?.Timestamp?.RealValue ?? (pve as Record<string, unknown>)?.timestamp);
          if (Math.abs(ts - 0.25) > 0.001) continue;
          for (const gn of (gve.notes ?? gve.Notes ?? []) as Record<string, unknown>[]) {
            const svg = typeof gn.getSVGGElement === 'function' ? gn.getSVGGElement() : null;
            if (svg) gveSvgCount++;
            console.log(`gve svg=${!!svg} src=${!!gn.sourceNote}`);
          }
        }
      }
    }
  }

  console.log('srcSvgCount', srcSvgCount, 'gveSvgCount', gveSvgCount);
  console.log('--- before align ---');
  alignLinkedParallelOnsetGraphics(osmd as never, hints, host);
  console.log('--- after align ---');
}

main().catch(console.error);
