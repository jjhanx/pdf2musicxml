/** OSMD graphic timestamps for m17 play_order2 preview pipeline */
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

function applyRules(rules: Record<string, unknown>): void {
  rules.RenderMeasureNumbers = false;
  rules.UseXMLMeasureNumbers = false;
}

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default
    ?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
  requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
const STEP = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

function buildPreviewXml(): string {
  const raw = execSync('python _smoke/_export_m17_play_order2.py', { encoding: 'utf8', maxBuffer: 20e6 });
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
  return new XMLSerializer().serializeToString(doc);
}

function pitchFromSrc(src: Record<string, unknown>): string {
  const p = (src.Pitch ?? src.pitch) as Record<string, unknown> | undefined;
  if (!p) return '?';
  const fn = Number(p.FundamentalNote ?? p.fundamentalNote);
  const oct = Number(p.Octave ?? p.octave);
  const acc = Number(p.Accidental ?? p.accidental);
  const a = acc === -1 ? 'b' : acc === 1 ? '#' : '';
  return `${STEP[fn] ?? '?'}${a}${oct}`;
}

async function main() {
  const previewWithX = buildPreviewXml();
  const osmdLoad = repairTimelineForOsmdPreview(previewWithX); // strips default-x like browser

  const host = document.getElementById('host')!;
  host.style.width = '900px';
  host.style.height = '400px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  applyRules((osmd as { EngravingRules: Record<string, unknown> }).EngravingRules);
  await (osmd as { load: (x: string) => Promise<void> }).load(osmdLoad);
  (osmd as { render: () => void }).render();

  const sheet = (osmd as unknown as { graphic?: { MeasureList?: unknown[] } }).graphic;
  const measures = (sheet?.MeasureList ?? []) as Record<string, unknown>[];
  const m17g = measures.find((m) => Number(m.MeasureNumber ?? m.measureNumber) === 17);
  if (!m17g) { console.log('m17 graphic missing'); return; }

  console.log('=== OSMD staff entries m17 (before SVG align) ===');
  const entries = (m17g.staffEntries ?? m17g.StaffEntries ?? []) as Record<string, unknown>[];
  for (const se of entries) {
    const rel = ((se.PositionAndShape ?? se.positionAndShape) as Record<string, unknown> | undefined);
    const pos = rel?.RelativePosition ?? rel?.relativePosition;
    const px = pos && typeof pos === 'object' ? Number((pos as Record<string, unknown>).x ?? (pos as Record<string, unknown>).X) : NaN;
    const ts = se.relInMeasureTimestamp ?? se.RelInMeasureTimestamp;
    const tsVal = ts && typeof ts === 'object'
      ? Number((ts as Record<string, unknown>).RealValue ?? (ts as Record<string, unknown>).realValue)
      : Number(ts);
    const notes: string[] = [];
    for (const gve of (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as Record<string, unknown>[]) {
      for (const gn of (gve.notes ?? gve.Notes ?? []) as Record<string, unknown>[]) {
        const src = (gn.sourceNote ?? gn.SourceNote) as Record<string, unknown>;
        notes.push(pitchFromSrc(src));
      }
    }
    if (notes.length) console.log(`  ts=${tsVal?.toFixed(3)} relX=${px?.toFixed(1)} notes=[${notes.join(', ')}]`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
