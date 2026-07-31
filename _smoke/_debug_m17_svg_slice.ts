/** m17 slice only — SVG x after render */
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
  Node: dom.window.Node, Element: dom.window.Element, SVGElement: dom.window.SVGElement,
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

function pitchFromHalfTone(ht: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const oct = Math.floor(ht / 12) - 1;
  return `${names[ht % 12]}${oct}`;
}

function dump(osmd: unknown, label: string) {
  console.log(`\n=== ${label} ===`);
  const rules = (osmd as { EngravingRules: { GNote: (n: unknown) => Record<string, unknown> } }).EngravingRules;
  const sheet = (osmd as unknown as { Sheet: { SourceMeasures: Record<string, unknown>[] } }).Sheet;
  for (const sm of sheet.SourceMeasures) {
    for (const vc of (sm.VerticalSourceStaffEntryContainers ?? []) as Record<string, unknown>[]) {
      const t = Number((vc.Timestamp as Record<string, unknown>)?.RealValue);
      if (t !== 0.25) continue;
      for (const se of (vc.StaffEntries ?? []) as Record<string, unknown>[]) {
        if (!se) continue;
        for (const ve of (se.VoiceEntries ?? []) as Record<string, unknown>[]) {
          const voice = (ve.ParentVoice as Record<string, unknown> | undefined)?.VoiceId;
          for (const n of (ve.Notes ?? []) as Record<string, unknown>[]) {
            const ht = Number(n.halfTone ?? n.HalfTone);
            const gn = rules.GNote(n);
            const pos = gn.PositionAndShape as Record<string, unknown>;
            (pos.calculateAbsolutePosition as () => void)();
            const absX = (pos.AbsolutePosition as Record<string, unknown>)?.x;
            const svg = (gn as { getSVGGElement?: () => SVGGraphicsElement }).getSVGGElement?.();
            let svgX = '?';
            if (svg?.getBBox) {
              try { const bb = svg.getBBox(); svgX = String(Math.round((bb.x + bb.width / 2) * 100) / 100); } catch { /* */ }
            }
            console.log(`v=${voice} ${pitchFromHalfTone(ht)} absX=${absX} svgX=${svgX}`);
          }
        }
      }
    }
  }
}

async function main() {
  const raw = execSync('python _smoke/_export_m17_parallel_fix.py', { encoding: 'utf8', maxBuffer: 20e6 });
  const slice = buildM17Slice(raw);
  const hints = collectLinkedParallelOnsetHintsFromXml(slice);
  console.log('hints', hints);

  const host = document.getElementById('h')!;
  host.style.width = '900px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg' });
  await (osmd as { load: (x: string) => Promise<void> }).load(slice);
  (osmd as { render: () => void }).render();
  dump(osmd, 'after render');
  alignLinkedParallelOnsetGraphics(osmd as never, hints);
  dump(osmd, 'after align');
}

main().catch(console.error);
