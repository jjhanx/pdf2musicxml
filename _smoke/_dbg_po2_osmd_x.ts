/** play_order2: OSMD timestamps before/after SVG align */
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
import { repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
import {
  alignOsmdPreviewNotesByOnsetColumn,
  registerOsmdPreviewXmlForAlign,
} from '../src/osmdOnsetColumnAlignFix';

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
const STEP = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

function build(raw: string) {
  let xml = repairTimelineForOsmdPreview(raw);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
  const m17 = [...part.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === '17') as Element;
  for (const child of [...m17.children]) {
    if (local(child) === 'note') {
      const st = child.querySelector('staff,*|staff')?.textContent?.trim();
      if (st && st !== '1') child.remove();
    }
  }
  m17.querySelectorAll('note staff,note *|staff').forEach((el) => { el.textContent = '1'; });
  pruneCrossStaffTimelineForOsmdPreview(m17, 1);
  snapshotNoteDefaultXForOsmdPreview(m17);
  reorderSingleStaffTimelineByOnsetForOsmdPreview(m17);
  normalizeMultiVoiceLayersForOsmdPreview(m17);
  realignMeasureDefaultXFromTimelineForOsmd(m17);
  const preview = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P5"><part-name/></score-part></part-list><part id="P5">${m17.outerHTML}</part></score-partwise>`;
  let load = repairMissingNoteTypesForOsmdPreview(repairTimelineForOsmdPreview(preview));
  return { preview, load };
}

function pitch(n: Record<string, unknown>): string {
  const p = n.Pitch ?? n.pitch;
  if (!p || typeof p !== 'object') return '?';
  const r = p as Record<string, unknown>;
  const fn = Number(r.FundamentalNote ?? r.fundamentalNote);
  const oct = Number(r.Octave ?? r.octave);
  const acc = Number(r.Accidental ?? r.accidental ?? 0);
  return `${STEP[fn] ?? fn}${acc < 0 ? 'b' : acc > 0 ? '#' : ''}${oct}`;
}

function dump(osmd: unknown, label: string) {
  console.log(`\n=== ${label} ===`);
  const rules = (osmd as { EngravingRules: { GNote: (n: unknown) => Record<string, unknown> } }).EngravingRules;
  const sheet = (osmd as { Sheet: { SourceMeasures: Record<string, unknown>[] } }).Sheet;
  for (const sm of sheet.SourceMeasures) {
    console.log('SM', sm.MeasureNumberXML, sm.MeasureNumber);
    for (const vc of (sm.VerticalSourceStaffEntryContainers ?? []) as Record<string, unknown>[]) {
      const t = Number((vc.Timestamp as Record<string, unknown>)?.RealValue);
      for (const se of (vc.StaffEntries ?? []) as Record<string, unknown>[]) {
        if (!se) continue;
        for (const ve of (se.VoiceEntries ?? []) as Record<string, unknown>[]) {
          const voice = (ve.ParentVoice as Record<string, unknown> | undefined)?.VoiceId;
          for (const n of (ve.Notes ?? []) as Record<string, unknown>[]) {
            const gn = rules.GNote(n);
            const pos = gn.PositionAndShape as Record<string, unknown>;
            (pos.calculateAbsolutePosition as () => void)?.();
            const abs = pos.AbsolutePosition as Record<string, unknown>;
            const svg = (gn as { getSVGGElement?: () => SVGGraphicsElement }).getSVGGElement?.();
            const bb = svg?.getBBox?.();
            const x = bb ? bb.x + bb.width / 2 : abs?.x;
            if (['E5', 'F4', 'F5', 'G4'].includes(pitch(n)) || t <= 0.5) {
              console.log(`t=${t.toFixed(3)} v=${voice} ${pitch(n)} x=${x}`);
            }
          }
        }
      }
    }
  }
}

async function main() {
  const raw = execSync('python _smoke/_export_m17_play_order2.py', { encoding: 'utf8', maxBuffer: 20e6 });
  const { preview, load } = build(raw);
  const host = document.getElementById('h')!;
  host.style.width = '900px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg' });
  registerOsmdPreviewXmlForAlign(osmd as never, preview);
  await (osmd as { load: (x: string) => Promise<void> }).load(load);
  (osmd as { render: () => void }).render();
  dump(osmd, 'before align');
  alignOsmdPreviewNotesByOnsetColumn(osmd as never);
  dump(osmd, 'after align');
}

main().catch(console.error);
