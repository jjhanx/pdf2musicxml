/**
 * m17: onset-column align without VoiceSpacing=0.
 * Run: npx tsx _smoke/test_m17_svg_notehead_align.ts
 */
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
import { alignOsmdPreviewNotesByOnsetColumn } from '../src/osmdOnsetColumnAlignFix';

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
  requestAnimationFrame: (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
    return 0;
  },
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
    [...measure.querySelectorAll('note staff,note *|staff')].forEach((el) => {
      el.textContent = '1';
    });
    pruneCrossStaffTimelineForOsmdPreview(measure, 1);
    snapshotNoteDefaultXForOsmdPreview(measure);
    reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
    normalizeMultiVoiceLayersForOsmdPreview(measure);
    realignMeasureDefaultXFromTimelineForOsmd(measure);
  }
  const m17 = [...part.children].find(
    (c) => local(c) === 'measure' && c.getAttribute('number') === '17',
  )!;
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><part-list><score-part id="P5"><part-name/></score-part></part-list><part id="P5">${m17.outerHTML}</part></score-partwise>`;
}

function noteheadCenterX(stavenote: SVGGraphicsElement): number | null {
  const xs: number[] = [];
  for (const path of stavenote.querySelectorAll('.vf-notehead path')) {
    const d = path.getAttribute('d');
    if (!d) continue;
    const m = /^M\s*([-\d.]+)/.exec(d.trim());
    if (!m) continue;
    const localX = parseFloat(m[1]!);
    const pathEl = path as SVGGraphicsElement;
    const ctm = pathEl.getCTM?.();
    if (ctm) {
      xs.push(ctm.a * localX + ctm.e);
      continue;
    }
    let tx = 0;
    let cur: Element | null = pathEl;
    while (cur) {
      const tr = cur.getAttribute?.('transform') ?? '';
      const tm = /translate\(\s*([-\d.]+)/.exec(tr);
      if (tm) tx += parseFloat(tm[1]!);
      cur = cur.parentElement;
    }
    xs.push(tx + localX);
  }
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

async function main() {
  if (!fs.existsSync('omr-work-0ea5ea52.zip')) {
    console.log('skip');
    return;
  }
  const raw = execSync('python _smoke/_export_m17_parallel_fix.py', { encoding: 'utf8', maxBuffer: 20e6 });
  const slice = buildM17Slice(raw);
  const host = document.getElementById('host')!;
  host.style.width = '900px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  const rules = (osmd as { EngravingRules: Record<string, unknown> }).EngravingRules;
  await (osmd as { load: (x: string) => Promise<void> }).load(slice);
  (osmd as { render: () => void }).render();
  alignOsmdPreviewNotesByOnsetColumn(osmd as never);

  const xs = [...host.querySelectorAll('.vf-stavenote, .vf-staveNote')]
    .map((sn) => noteheadCenterX(sn as SVGGraphicsElement))
    .filter((x): x is number => x != null)
    .sort((a, b) => a - b);
  if (xs.length < 3) throw new Error(`expected >=3 stavenotes, got ${xs.length}`);
  const parallelXs = xs.slice(1, 3);
  const spread = Math.abs(parallelXs[1]! - parallelXs[0]!);
  if (spread > 0.5) throw new Error(`misalign spread=${spread}`);
  if (rules.VoiceSpacingMultiplierVexflow === 0) throw new Error('VoiceSpacing unchanged');
  console.log('OK m17 onset column', { spread, xs });
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
