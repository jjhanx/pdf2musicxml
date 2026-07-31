/** Full P5 PR — graphic vs source x at m17 t=0.25 */
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
  const partXml = [...part.children].map((c) => c.outerHTML).join('');
  return `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P5"><part-name/></score-part></part-list><part id="P5">${partXml}</part></score-partwise>`;
}

function pitch(ht: number): string {
  const n = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  return `${n[ht % 12]}${Math.floor(ht / 12) - 1}`;
}

async function main() {
  const raw = execSync('python _smoke/_export_m17_parallel_fix.py', { encoding: 'utf8', maxBuffer: 20e6 });
  const xml = buildFullPr(raw);
  const host = document.getElementById('h')!;
  host.style.width = '1400px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg' });
  await (osmd as { load: (x: string) => Promise<void> }).load(xml);
  (osmd as { render: () => void }).render();

  const rules = (osmd as { EngravingRules: { GNote: (n: unknown) => Record<string, unknown> } }).EngravingRules;
  console.log('\n--- SOURCE m17 t=0.25 ---');
  const sheet = (osmd as unknown as { Sheet: { SourceMeasures: Record<string, unknown>[] } }).Sheet;
  for (const sm of sheet.SourceMeasures) {
    if (Number(sm.MeasureNumberXML) !== 17) continue;
    for (const vc of (sm.VerticalSourceStaffEntryContainers ?? []) as Record<string, unknown>[]) {
      if (Number((vc.Timestamp as Record<string, unknown>)?.RealValue) !== 0.25) continue;
      for (const se of (vc.StaffEntries ?? []) as Record<string, unknown>[]) {
        if (!se) continue;
        for (const ve of (se.VoiceEntries ?? []) as Record<string, unknown>[]) {
          const voice = (ve.ParentVoice as Record<string, unknown>)?.VoiceId;
          for (const n of (ve.Notes ?? []) as Record<string, unknown>[]) {
            const gn = rules.GNote(n);
            const pos = gn.PositionAndShape as Record<string, unknown>;
            (pos.calculateAbsolutePosition as () => void)();
            console.log(`src v=${voice} ${pitch(Number(n.halfTone))} absX=${(pos.AbsolutePosition as Record<string, unknown>)?.x}`);
          }
        }
      }
    }
  }

  console.log('\n--- GRAPHIC m17 via forEach ---');
  forEachGraphicalMeasure(osmd as never, (gm) => {
    if (measureMxlFromGraphic(gm) !== 17) return;
    const g = gm as Record<string, unknown>;
    for (const se of (g.staffEntries ?? g.StaffEntries ?? []) as Record<string, unknown>[]) {
      for (const gve of (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as Record<string, unknown>[]) {
        const pve = asRec(gve.parentVoiceEntry ?? gve.ParentVoiceEntry);
        const tsVal = num(pve?.Timestamp ?? pve?.timestamp);
        if (tsVal == null || Math.abs(tsVal - 0.25) > 0.001) continue;
        const pos = asRec(gve.PositionAndShape ?? gve.positionAndShape);
        const rel = asRec(pos?.RelativePosition ?? pos?.relativePosition);
        const notes = (gve.notes ?? gve.Notes ?? []) as Record<string, unknown>[];
        const labels = notes.map((n) => pitch(Number(asRec(n.sourceNote ?? n.SourceNote)?.halfTone ?? -1)));
        console.log(`gve gveX=${num(rel?.x ?? rel?.X)} ts=${tsVal} notes=${labels.join('+')}`);
      }
    }
  });
}

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}
function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const r = asRec(v);
  if (!r) return null;
  if (typeof r.RealValue === 'number') return r.RealValue;
  if (typeof r.realValue === 'number') return r.realValue;
  return null;
}

main().catch(console.error);
