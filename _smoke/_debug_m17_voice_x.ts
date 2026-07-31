/** OSMD VoiceEntry voice id structure */
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
import {
  repairTimelineForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';

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
const NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

function buildSlice(raw: string): string {
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

function pitch(n: Record<string, unknown>): string {
  const p = n.Pitch ?? n.pitch;
  if (!p || typeof p !== 'object') return '?';
  const r = p as Record<string, unknown>;
  const fn = Number(r.FundamentalNote ?? r.fundamentalNote);
  const oct = Number(r.Octave ?? r.octave);
  const acc = Number(r.Accidental ?? r.accidental ?? 0);
  return `${NAMES[fn] ?? fn}${acc < 0 ? 'b' : acc > 0 ? '#' : ''}${oct}`;
}

async function main() {
  const raw = execSync('python _smoke/_export_m17_parallel_fix.py', { encoding: 'utf8', maxBuffer: 20e6 });
  const host = document.getElementById('h')!;
  host.style.width = '900px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg' });
  await (osmd as { load: (x: string) => Promise<void> }).load(buildSlice(raw));
  (osmd as { render: () => void }).render();
  const rules = (osmd as { EngravingRules: { GNote: (n: unknown) => Record<string, unknown> } }).EngravingRules;
  const sheet = (osmd as unknown as { Sheet: { SourceMeasures: Record<string, unknown>[] } }).Sheet;
  for (const sm of sheet.SourceMeasures) {
    console.log('MN XML', sm.MeasureNumberXML, 'printed', sm.MeasureNumber);
    for (const vc of (sm.VerticalSourceStaffEntryContainers ?? []) as Record<string, unknown>[]) {
      const t = (vc.Timestamp as Record<string, unknown>)?.RealValue;
      if (Number(t) !== 0.25) continue;
      for (const se of (vc.StaffEntries ?? []) as Record<string, unknown>[]) {
        if (!se) continue;
        for (const ve of (se.VoiceEntries ?? []) as Record<string, unknown>[]) {
          const parent = ve.ParentVoice as Record<string, unknown> | undefined;
          const voice = ve.voiceId ?? parent?.VoiceId ?? parent?.voiceId ?? JSON.stringify(parent);
          const notes = (ve.Notes ?? []) as Record<string, unknown>[];
          for (const n of notes) {
            const gn = rules.GNote(n);
            const pos = gn.PositionAndShape as Record<string, unknown>;
            (pos.calculateAbsolutePosition as () => void)();
            const abs = pos.AbsolutePosition as Record<string, unknown>;
            const svg = (gn as { getSVGGElement?: () => SVGGraphicsElement }).getSVGGElement?.();
            const bb = svg?.getBBox?.();
            console.log(`t=${t} voice=${voice} ${pitch(n)} absX=${abs?.x} svgX=${bb ? bb.x + bb.width / 2 : '?'}`);
          }
        }
      }
    }
  }
}

main().catch(console.error);
