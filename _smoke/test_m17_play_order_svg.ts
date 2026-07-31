/**
 * setPlayOrder path: OSMD SVG align after play order apply.
 * Run: npx tsx _smoke/test_m17_play_order_svg.ts
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
import { buildOsmdPreviewXml } from '../src/AudiverisInspectPanel';
import {
  alignOsmdPreviewNotesByOnsetColumn,
  registerOsmdPreviewXmlForAlign,
} from '../src/osmdOnsetColumnAlignFix';
import { collectPlayOrderAlignGroupsFromXml } from '../shared/musicXmlPlayOrder';

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
    if (ctm) xs.push(ctm.a * localX + ctm.e);
  }
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

async function main() {
  if (!fs.existsSync('omr-work-0ea5ea52.zip')) {
    console.log('skip');
    return;
  }
  const raw = execSync('python _smoke/_export_m17_play_order2.py', { encoding: 'utf8', maxBuffer: 20e6 });
  const scoreParts = [{ partId: 'P5', displayLabel: 'PR', suggestedLabel: 'PR', staffIndex: 5 }];
  const filter = { partId: 'P5', staffWithinPart: 1, label: 'PR' };
  const preview = buildOsmdPreviewXml(raw, scoreParts as never, filter as never, { verbatim: true });
  const groups = collectPlayOrderAlignGroupsFromXml(preview);
  console.log('align groups m17:', groups.filter((g) => g.measureNumber === 17));

  const host = document.getElementById('host')!;
  host.style.width = '900px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  registerOsmdPreviewXmlForAlign(osmd as never, preview);
  await (osmd as { load: (x: string) => Promise<void> }).load(preview);
  (osmd as { render: () => void }).render();
  alignOsmdPreviewNotesByOnsetColumn(osmd as never, preview);

  const byPitch = new Map<string, number[]>();
  for (const sn of host.querySelectorAll('.vf-stavenote, .vf-staveNote')) {
    const x = noteheadCenterX(sn as SVGGraphicsElement);
    if (x == null) continue;
    // crude: use y bucket as pitch proxy — just collect all x
    const key = String(Math.round((sn as SVGGraphicsElement).getBBox?.().y ?? 0));
    const list = byPitch.get(key) ?? [];
    list.push(x);
    byPitch.set(key, list);
  }
  const allX = [...host.querySelectorAll('.vf-stavenote, .vf-staveNote')]
    .map((sn) => noteheadCenterX(sn as SVGGraphicsElement))
    .filter((x): x is number => x != null);
  console.log('notehead X count', allX.length, 'unique', new Set(allX.map((x) => Math.round(x))).size);
  console.log('sample xs', allX.sort((a, b) => a - b).slice(0, 12));
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
