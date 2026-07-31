/** po=2 F4/Bb4/E5 SVG align detail */
import fs from 'node:fs';
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
import {
  collectPlayOrderAlignGroupsFromXml,
  collectPreviewNoteLayoutTargetsFromXml,
  HITL_PLAY_ORDER_ATTR,
} from '../shared/musicXmlPlayOrder';
import {
  alignOsmdPreviewNotesByOnsetColumn,
  registerOsmdPreviewXmlForAlign,
} from '../src/osmdOnsetColumnAlignFix';
import { forEachGraphicalMeasure, measureMxlFromGraphic, partIdFromGraphic } from '../src/osmdMeasureClick';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default
    ?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  Node: dom.window.Node,
  Element: dom.window.Element,
  requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});
if (!dom.window.SVGSVGElement.prototype.createSVGPoint) {
  dom.window.SVGSVGElement.prototype.createSVGPoint = function () {
    const pt = { x: 0, y: 0 };
    return {
      ...pt,
      matrixTransform(m: DOMMatrix) {
        return { x: m.a * pt.x + m.c * pt.y + m.e, y: m.b * pt.x + m.d * pt.y + m.f };
      },
    };
  } as typeof dom.window.SVGSVGElement.prototype.createSVGPoint;
}

const STEP = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
const pitch = (n: Element) => {
  const s = n.querySelector('step,*|step')?.textContent ?? '';
  const o = n.querySelector('octave,*|octave')?.textContent ?? '';
  const a = n.querySelector('alter,*|alter')?.textContent ?? '';
  return `${s}${a === '-1' ? 'b' : ''}${o}`;
};

function buildPreview(raw: string): string {
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
  return `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P5"><part-name/></score-part></part-list><part id="P5">${m17.outerHTML}</part></score-partwise>`;
}

function noteheadX(sn: SVGGraphicsElement): number | null {
  const xs: number[] = [];
  for (const path of sn.querySelectorAll('.vf-notehead path')) {
    const d = path.getAttribute('d');
    const m = d && /^M\s*([-\d.]+)/.exec(d.trim());
    if (!m) continue;
    const ctm = (path as SVGGraphicsElement).getCTM?.();
    if (ctm) xs.push(ctm.a * parseFloat(m[1]!) + ctm.e);
  }
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function pitchFromGn(gn: Record<string, unknown>): string | null {
  const src = (gn.sourceNote ?? gn.SourceNote) as Record<string, unknown> | undefined;
  const p = (src?.Pitch ?? src?.pitch) as Record<string, unknown> | undefined;
  if (!p) return null;
  const fn = typeof p.FundamentalNote === 'number' ? p.FundamentalNote : (p.fundamentalNote as number);
  const oct = typeof p.Octave === 'number' ? p.Octave : (p.octave as number);
  const acc = typeof p.Accidental === 'number' ? p.Accidental : (p.accidental as number);
  const a = acc === -1 ? 'b' : acc === 1 ? '#' : '';
  return `${STEP[fn] ?? '?'}${a}${oct}`;
}

function dumpGraphicPitches(osmd: unknown, label: string) {
  const rows: { pitch: string; x: number | null; partId: string | null; m: number | null }[] = [];
  forEachGraphicalMeasure(osmd as never, (gm) => {
    const partId = partIdFromGraphic(gm);
    const m = measureMxlFromGraphic(gm);
    const g = gm as Record<string, unknown>;
    for (const se of (g.staffEntries ?? g.StaffEntries ?? []) as Record<string, unknown>[]) {
      for (const gve of (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as Record<string, unknown>[]) {
        for (const gn of (gve.notes ?? gve.Notes ?? []) as Record<string, unknown>[]) {
          const p = pitchFromGn(gn);
          if (!p) continue;
          const svg = typeof gn.getSVGGElement === 'function' ? (gn.getSVGGElement() as SVGGraphicsElement) : null;
          const sn = svg?.closest('.vf-stavenote,.vf-staveNote') as SVGGraphicsElement | null ?? svg;
          rows.push({ pitch: p, x: sn ? noteheadX(sn) : null, partId, m });
        }
      }
    }
  });
  console.log(`\n${label} all pitches:`, rows.length, rows.slice(0, 20));
  console.log(`${label} po2:`, rows.filter((r) => ['F4', 'Bb4', 'E5'].includes(r.pitch)));
}

async function main() {
  if (!fs.existsSync('omr-work-0ea5ea52.zip')) { console.log('skip'); return; }
  const raw = execSync('python _smoke/_export_m17_play_order2.py', { encoding: 'utf8', maxBuffer: 20e6 });
  const preview = buildPreview(raw);
  console.log('groups:', collectPlayOrderAlignGroupsFromXml(preview).filter((g) => g.playOrder === 2));
  console.log('targets po2 pitches:', [...new Set(collectPreviewNoteLayoutTargetsFromXml(preview).filter((t) => t.playOrder === 2).map((t) => t.pitch))]);

  const host = document.getElementById('host')!;
  host.style.width = '900px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  registerOsmdPreviewXmlForAlign(osmd as never, preview);
  await (osmd as { load: (x: string) => Promise<void> }).load(preview);
  (osmd as { render: () => void }).render();
  dumpGraphicPitches(osmd, 'before align');
  alignOsmdPreviewNotesByOnsetColumn(osmd as never, preview);
  dumpGraphicPitches(osmd, 'after align');

  const po2 = ['F4', 'Bb4', 'E5'];
  const xs: number[] = [];
  forEachGraphicalMeasure(osmd as never, (gm) => {
    if (measureMxlFromGraphic(gm) !== 17) return;
    const g = gm as Record<string, unknown>;
    for (const se of (g.staffEntries ?? g.StaffEntries ?? []) as Record<string, unknown>[]) {
      for (const gve of (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as Record<string, unknown>[]) {
        for (const gn of (gve.notes ?? gve.Notes ?? []) as Record<string, unknown>[]) {
          const p = pitchFromGn(gn);
          if (!p || !po2.includes(p)) continue;
          const svg = typeof gn.getSVGGElement === 'function' ? (gn.getSVGGElement() as SVGGraphicsElement) : null;
          const sn = svg?.closest('.vf-stavenote,.vf-staveNote') as SVGGraphicsElement | null ?? svg;
          const x = sn ? noteheadX(sn) : null;
          if (x != null) xs.push(x);
        }
      }
    }
  });
  const uniq = [...new Set(xs.map((x) => Math.round(x * 10) / 10))];
  console.log('po2 xs', xs, 'spread', Math.max(...xs) - Math.min(...xs));
  if (xs.length >= 2 && Math.max(...xs) - Math.min(...xs) > 2) {
    throw new Error(`po2 misaligned spread=${Math.max(...xs) - Math.min(...xs)} uniq=${uniq.join(',')}`);
  }
  console.log('OK');
}

main().catch((e) => { console.error(e); process.exit(1); });
